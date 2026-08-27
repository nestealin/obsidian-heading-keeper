import { describe, expect, it } from "vitest";
import {
  inspectRecovery,
  restoreEligibleFiles,
} from "../src/persistence/executor.js";
import { applyCheckedEdits, invertEdits } from "../src/persistence/edits.js";
import type {
  JournalStore,
  PersistedOperation,
  VaultFileAdapter,
} from "../src/persistence/types.js";

function fileChange(
  path: string,
  beforeText: string,
  afterText: string,
  role: "target" | "link-source",
) {
  const edits = [
    {
      range: { from: 0, to: beforeText.length },
      expectedText: beforeText,
      replacementText: afterText,
    },
  ];
  return {
    path,
    beforeHash: `hash:${beforeText}`,
    afterHash: `hash:${afterText}`,
    edits,
    inverseEdits: invertEdits(beforeText, edits),
    role,
  };
}

describe("inspectRecovery", () => {
  it("classifies an exact after-image as eligible", async () => {
    const operation: PersistedOperation = {
      id: "op-1",
      createdAt: "2026-08-25T00:00:00.000Z",
      state: "recovery-required",
      files: [fileChange("Target.md", "before", "after", "target")],
      completedPaths: [],
    };
    const vault: VaultFileAdapter = {
      read: async () => "after",
      compareAndUpdate: async () => ({ kind: "updated" }),
    };
    const journal: JournalStore = {
      load: async () => operation,
      save: async () => undefined,
    };

    const result = await inspectRecovery(operation, {
      vault,
      journal,
      hashText: async (text) => `hash:${text}`,
    });

    expect(result).toEqual({
      kind: "inspected",
      files: [
        {
          path: "Target.md",
          role: "target",
          status: "eligible",
        },
      ],
      diagnostics: [],
    });
  });
});

const hashText = async (text: string) => `hash:${text}`;

function recoveryOperation(
  state: PersistedOperation["state"] = "recovery-required",
): PersistedOperation {
  return {
    id: "op-recovery",
    createdAt: "2026-08-25T00:00:00.000Z",
    state,
    files: [
      fileChange("Target.md", "before target", "after target", "target"),
      fileChange("a.md", "before a", "after a", "link-source"),
      fileChange("z.md", "before z", "after z", "link-source"),
      fileChange(
        "zz-pending.md",
        "before pending",
        "after pending",
        "link-source",
      ),
    ],
    completedPaths: ["a.md"],
  };
}

function recoveryAdapters(initial: Record<string, string>) {
  const content = new Map(Object.entries(initial));
  const writes: string[] = [];
  const saves: PersistedOperation[] = [];
  const vault: VaultFileAdapter & {
    write(path: string, text: string): Promise<void>;
  } = {
    read: async (path) => {
      const value = content.get(path);
      if (value === undefined) throw new Error("private read text");
      return value;
    },
    write: async (path, text) => {
      writes.push(path);
      content.set(path, text);
    },
    compareAndUpdate: async (
      path,
      expectedHash,
      resultingHash,
      edits,
      hash,
    ) => {
      const current = await vault.read(path);
      const currentHash = await hash(current);
      if (currentHash === resultingHash) return { kind: "already-applied" };
      if (currentHash !== expectedHash) return { kind: "stale" };
      const updated = applyCheckedEdits(current, edits);
      if ((await hash(updated)) !== resultingHash) {
        throw new Error("readback mismatch");
      }
      await vault.write(path, updated);
      return { kind: "updated" };
    },
  };
  const journal: JournalStore = {
    load: async () => null,
    save: async (value) => {
      saves.push(value);
    },
  };
  return { content, journal, saves, vault, writes };
}

describe("conservative recovery", () => {
  it("uses exact current images as authority for all four statuses", async () => {
    const state = recoveryAdapters({
      "Target.md": "after target",
      "a.md": "before a",
      "z.md": "external z",
      "zz-pending.md": "before pending",
    });
    const result = await inspectRecovery(recoveryOperation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result.files.map(({ path, status }) => [path, status])).toEqual([
      ["Target.md", "eligible"],
      ["a.md", "restored"],
      ["z.md", "changed"],
      ["zz-pending.md", "pending"],
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("turns read failures into stable changed diagnostics", async () => {
    const state = recoveryAdapters({});
    const result = await inspectRecovery(
      { ...recoveryOperation(), files: recoveryOperation().files.slice(0, 1) },
      { vault: state.vault, journal: state.journal, hashText },
    );
    expect(result.files[0]?.status).toBe("changed");
    expect(result.diagnostics).toEqual([
      {
        code: "recovery-read-error",
        path: "Target.md",
        message: "Unable to inspect current file.",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private read text");
  });

  it("restores every eligible after-image in reverse order and leaves conflicts untouched", async () => {
    const state = recoveryAdapters({
      "Target.md": "after target",
      "a.md": "external a",
      "z.md": "after z",
      "zz-pending.md": "before pending",
    });
    const result = await restoreEligibleFiles(recoveryOperation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(state.writes).toEqual(["z.md", "Target.md"]);
    expect(state.content.get("Target.md")).toBe("before target");
    expect(state.content.get("z.md")).toBe("before z");
    expect(state.content.get("a.md")).toBe("external a");
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "recovery-conflict",
    });
    expect(state.saves[0]?.state).toBe("restoring");
  });

  it("restores a write whose progress journal never recorded completion", async () => {
    const op = {
      ...recoveryOperation(),
      files: recoveryOperation().files.slice(0, 2),
      completedPaths: [],
    };
    const state = recoveryAdapters({
      "Target.md": "after target",
      "a.md": "before a",
    });
    const result = await restoreEligibleFiles(op, {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(state.writes).toEqual(["Target.md"]);
    expect(state.content.get("Target.md")).toBe("before target");
    expect(result.kind).toBe("restored");
  });

  it("is idempotent after restoration", async () => {
    const op = {
      ...recoveryOperation("restored"),
      files: recoveryOperation().files.slice(0, 2),
      completedPaths: ["Target.md", "a.md"],
    };
    const state = recoveryAdapters({
      "Target.md": "before target",
      "a.md": "before a",
    });
    const first = await restoreEligibleFiles(op, {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    const second = await restoreEligibleFiles(first.operation, {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(first.kind).toBe("restored");
    expect(second.kind).toBe("restored");
    expect(state.writes).toEqual([]);
  });

  it("performs no writes when the restoring journal cannot be made durable", async () => {
    const state = recoveryAdapters({
      "Target.md": "after target",
      "a.md": "before a",
      "z.md": "before z",
      "zz-pending.md": "before pending",
    });
    state.journal.save = async () => {
      throw new Error("private journal text");
    };
    const result = await restoreEligibleFiles(recoveryOperation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "journal-error",
      code: "journal-error",
    });
    expect(result.operation.files).toHaveLength(4);
    expect(state.writes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private journal text");
  });

  it("stops reverse restoration after a write failure", async () => {
    const state = recoveryAdapters({
      "Target.md": "after target",
      "a.md": "before a",
      "z.md": "after z",
      "zz-pending.md": "before pending",
    });
    state.vault.write = async (path) => {
      state.writes.push(path);
      throw new Error("private restore text");
    };
    const result = await restoreEligibleFiles(recoveryOperation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "restore-write-error",
    });
    expect(state.writes).toEqual(["z.md"]);
    expect(JSON.stringify(result)).not.toContain("private restore text");
  });

  it("rechecks an eligible image after the restoring journal and preserves a concurrent change", async () => {
    const op = {
      ...recoveryOperation(),
      files: recoveryOperation().files.slice(0, 1),
      completedPaths: ["Target.md"],
    };
    const state = recoveryAdapters({ "Target.md": "after target" });
    state.journal.save = async (saved) => {
      state.saves.push(saved);
      if (saved.state === "restoring")
        state.content.set("Target.md", "changed after journal");
    };
    const result = await restoreEligibleFiles(op, {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(state.writes).toEqual([]);
    expect(state.content.get("Target.md")).toBe("changed after journal");
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "recovery-conflict",
    });
  });

  it("rechecks every file immediately before reverse writes and continues around conflicts", async () => {
    const op = {
      ...recoveryOperation(),
      files: recoveryOperation().files.slice(0, 3),
      completedPaths: ["Target.md", "a.md", "z.md"],
    };
    const state = recoveryAdapters({
      "Target.md": "after target",
      "a.md": "after a",
      "z.md": "after z",
    });
    const baseWrite = state.vault.write.bind(state.vault);
    state.vault.write = async (path, text) => {
      await baseWrite(path, text);
      if (path === "z.md")
        state.content.set("a.md", "changed between reverse writes");
    };
    const result = await restoreEligibleFiles(op, {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(state.writes).toEqual(["z.md", "Target.md"]);
    expect(state.content.get("a.md")).toBe("changed between reverse writes");
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "recovery-conflict",
    });
  });

  it.each(["read", "hash"])(
    "preserves an eligible file when its pre-write %s throws",
    async (failure) => {
      const op = {
        ...recoveryOperation(),
        files: recoveryOperation().files.slice(0, 1),
        completedPaths: ["Target.md"],
      };
      const state = recoveryAdapters({ "Target.md": "after target" });
      let reads = 0;
      let hashes = 0;
      const baseRead = state.vault.read.bind(state.vault);
      state.vault.read = async (path) => {
        reads += 1;
        if (failure === "read" && reads === 2)
          throw new Error("private prewrite read");
        return baseRead(path);
      };
      const checkedHash = async (text: string) => {
        hashes += 1;
        if (failure === "hash" && hashes === 3)
          throw new Error("private prewrite hash");
        return hashText(text);
      };
      const result = await restoreEligibleFiles(op, {
        vault: state.vault,
        journal: state.journal,
        hashText: checkedHash,
      });
      expect(state.writes).toEqual([]);
      expect(state.content.get("Target.md")).toBe("after target");
      expect(result.kind).toBe("recovery-required");
      expect(JSON.stringify(result)).not.toContain("private prewrite");
    },
  );

  it("records a pre-write conflict even when a later inspection sees a safe before-image", async () => {
    const op = {
      ...recoveryOperation(),
      files: recoveryOperation().files.slice(0, 1),
      completedPaths: ["Target.md"],
    };
    const state = recoveryAdapters({ "Target.md": "after target" });
    let reads = 0;
    state.vault.read = async () => {
      reads += 1;
      if (reads === 1) return "after target";
      if (reads === 2) throw new Error("private transient read");
      return "before target";
    };
    const result = await restoreEligibleFiles(op, {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(state.writes).toEqual([]);
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "restore-write-error",
    });
  });

  it.each([
    ["preview state", () => recoveryOperation("previewed")],
    [
      "duplicate paths",
      () => {
        const value = recoveryOperation();
        return {
          ...value,
          files: [
            value.files[0]!,
            { ...value.files[1]!, path: "Target.md" },
            ...value.files.slice(2),
          ],
        };
      },
    ],
  ])(
    "rejects invalid restore operations before journal or Vault access: %s",
    async (_label, makeInvalid) => {
      const state = recoveryAdapters({});
      let loads = 0;
      state.journal.load = async () => {
        loads += 1;
        return null;
      };
      const result = await restoreEligibleFiles(makeInvalid(), {
        vault: state.vault,
        journal: state.journal,
        hashText,
      });
      expect(result).toMatchObject({
        kind: "recovery-required",
        code: "operation-invalid",
      });
      expect(loads).toBe(0);
      expect(state.writes).toEqual([]);
      expect(state.saves).toEqual([]);
    },
  );
});

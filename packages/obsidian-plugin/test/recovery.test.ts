import { describe, expect, it } from "vitest";
import {
  inspectRecovery,
  restoreEligibleFiles,
} from "../src/persistence/executor.js";
import type {
  JournalStore,
  PersistedOperation,
  VaultFileAdapter,
} from "../src/persistence/types.js";

describe("inspectRecovery", () => {
  it("classifies an exact after-image as eligible", async () => {
    const operation: PersistedOperation = {
      id: "op-1",
      createdAt: "2026-08-25T00:00:00.000Z",
      state: "recovery-required",
      files: [
        {
          path: "Target.md",
          beforeHash: "hash:before",
          beforeText: "before",
          afterHash: "hash:after",
          afterText: "after",
          role: "target",
        },
      ],
      completedPaths: [],
    };
    const vault: VaultFileAdapter = {
      read: async () => "after",
      write: async () => undefined,
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
      {
        path: "Target.md",
        beforeHash: "hash:before target",
        beforeText: "before target",
        afterHash: "hash:after target",
        afterText: "after target",
        role: "target",
      },
      {
        path: "a.md",
        beforeHash: "hash:before a",
        beforeText: "before a",
        afterHash: "hash:after a",
        afterText: "after a",
        role: "link-source",
      },
      {
        path: "z.md",
        beforeHash: "hash:before z",
        beforeText: "before z",
        afterHash: "hash:after z",
        afterText: "after z",
        role: "link-source",
      },
      {
        path: "pending.md",
        beforeHash: "hash:before pending",
        beforeText: "before pending",
        afterHash: "hash:after pending",
        afterText: "after pending",
        role: "link-source",
      },
    ],
    completedPaths: ["a.md"],
  };
}

function recoveryAdapters(initial: Record<string, string>) {
  const content = new Map(Object.entries(initial));
  const writes: string[] = [];
  const saves: PersistedOperation[] = [];
  const vault: VaultFileAdapter = {
    read: async (path) => {
      const value = content.get(path);
      if (value === undefined) throw new Error("private read text");
      return value;
    },
    write: async (path, text) => {
      writes.push(path);
      content.set(path, text);
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
      "pending.md": "before pending",
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
      ["pending.md", "pending"],
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
      "pending.md": "before pending",
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
      "pending.md": "before pending",
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
      "pending.md": "before pending",
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
});

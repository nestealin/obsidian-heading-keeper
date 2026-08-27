import { describe, expect, it } from "vitest";
import { executePersistedOperation } from "../src/persistence/executor.js";
import { applyCheckedEdits, invertEdits } from "../src/persistence/edits.js";
import type {
  JournalStore,
  PersistedOperation,
  VaultFileAdapter,
} from "../src/persistence/types.js";

const hashText = async (text: string) => `hash:${text}`;

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

function operation(
  state: PersistedOperation["state"] = "previewed",
): PersistedOperation {
  return {
    id: "op-1",
    createdAt: "2026-08-25T00:00:00.000Z",
    state,
    files: [
      fileChange("Target.md", "before target", "after target", "target"),
      fileChange("a.md", "before a", "after a", "link-source"),
      fileChange("z.md", "before z", "after z", "link-source"),
    ],
    completedPaths: [],
  };
}

function completedOperation(): PersistedOperation {
  return {
    ...operation("completed"),
    completedPaths: ["Target.md", "a.md", "z.md"],
  };
}

function harness(initial: Record<string, string>) {
  const content = new Map(Object.entries(initial));
  const events: string[] = [];
  const saves: PersistedOperation[] = [];
  const vault: VaultFileAdapter & {
    write(path: string, text: string): Promise<void>;
  } = {
    read: async (path) => {
      events.push(`read:${path}`);
      const text = content.get(path);
      if (text === undefined) throw new Error("sensitive read detail");
      return text;
    },
    write: async (path, text) => {
      events.push(`write:${path}`);
      content.set(path, text);
    },
    compareAndUpdate: async (
      path,
      expectedHash,
      resultingHash,
      edits,
      hash,
    ) => {
      const current = content.get(path);
      if (current === undefined) throw new Error("sensitive read detail");
      const currentHash = await hash(current);
      if (currentHash === resultingHash) return { kind: "already-applied" };
      if (currentHash !== expectedHash) return { kind: "stale" };
      await vault.write(path, applyCheckedEdits(current, edits));
      const written = content.get(path)!;
      if ((await hash(written)) !== resultingHash) throw new Error("mismatch");
      return { kind: "updated" };
    },
  };
  const journal: JournalStore = {
    load: async () => null,
    save: async (saved) => {
      events.push(`save:${saved.state}:${saved.completedPaths.join(",")}`);
      saves.push(saved);
    },
  };
  return { content, events, journal, saves, vault };
}

describe("executePersistedOperation", () => {
  it("preflights every source, durably journals, and writes target then sorted links", async () => {
    const state = harness({
      "Target.md": "before target",
      "a.md": "before a",
      "z.md": "before z",
    });
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });

    expect(result.kind).toBe("completed");
    expect(state.events.filter((event) => event.startsWith("write:"))).toEqual([
      "write:Target.md",
      "write:a.md",
      "write:z.md",
    ]);
    expect(state.events.indexOf("save:applying:")).toBeLessThan(
      state.events.indexOf("write:Target.md"),
    );
    expect(
      state.saves.map((saved) => [saved.state, saved.completedPaths]),
    ).toEqual([
      ["applying", []],
      ["applying", ["Target.md"]],
      ["applying", ["Target.md", "a.md"]],
      ["applying", ["Target.md", "a.md", "z.md"]],
      ["completed", ["Target.md", "a.md", "z.md"]],
    ]);
    expect(state.saves[0]?.files).toEqual(operation().files);
  });

  it("mutates nothing when any source is stale before apply", async () => {
    const state = harness({
      "Target.md": "before target",
      "a.md": "externally changed",
      "z.md": "before z",
    });
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "stale-plan",
      code: "source-stale",
      path: "a.md",
    });
    expect(state.events.filter((event) => event.startsWith("read:"))).toEqual([
      "read:Target.md",
      "read:a.md",
      "read:z.md",
    ]);
    expect(
      state.events.some(
        (event) => event.startsWith("write:") || event.startsWith("save:"),
      ),
    ).toBe(false);
  });

  it("preserves a concurrent edit that lands after preflight", async () => {
    const state = harness({
      "Target.md": "before target",
      "a.md": "before a",
      "z.md": "before z",
    });
    const baseCompare = state.vault.compareAndUpdate.bind(state.vault);
    let first = true;
    state.vault.compareAndUpdate = async (...args) => {
      if (first) {
        first = false;
        state.content.set("Target.md", "external edit after preflight");
      }
      return baseCompare(...args);
    };

    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });

    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "source-stale",
    });
    expect(state.content.get("Target.md")).toBe(
      "external edit after preflight",
    );
    expect(state.events.filter((event) => event.startsWith("write:"))).toEqual(
      [],
    );
  });

  it("resumes a preview whose files already match the after hashes without rewriting", async () => {
    const state = harness({
      "Target.md": "after target",
      "a.md": "after a",
      "z.md": "after z",
    });

    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });

    expect(result.kind).toBe("completed");
    expect(state.events.filter((event) => event.startsWith("write:"))).toEqual(
      [],
    );
    expect(result.operation.completedPaths).toEqual([
      "Target.md",
      "a.md",
      "z.md",
    ]);
  });

  it("turns thrown preflight reads into a stable zero-write result", async () => {
    const state = harness({ "Target.md": "before target", "z.md": "before z" });
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "source-read-error",
    });
    expect(JSON.stringify(result)).not.toContain("sensitive read detail");
    expect(
      state.events.some(
        (event) => event.startsWith("write:") || event.startsWith("save:"),
      ),
    ).toBe(false);
  });

  it("does not write when the durable applying journal fails", async () => {
    const state = harness({
      "Target.md": "before target",
      "a.md": "before a",
      "z.md": "before z",
    });
    state.journal.save = async () => {
      throw new Error("secret journal detail");
    };
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "journal-error",
      code: "journal-error",
    });
    expect(result.operation.files).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain("secret journal detail");
    expect(state.events.some((event) => event.startsWith("write:"))).toBe(
      false,
    );
  });

  it.each([
    ["write-error", "write"],
    ["write-error", "readback"],
  ])("stops after a partial apply on %s", async (expectedCode, failure) => {
    const state = harness({
      "Target.md": "before target",
      "a.md": "before a",
      "z.md": "before z",
    });
    const baseWrite = state.vault.write.bind(state.vault);
    state.vault.write = async (path, text) => {
      if (path === "a.md" && failure === "write")
        throw new Error("private write detail");
      await baseWrite(
        path,
        path === "a.md" && failure === "readback" ? "wrong" : text,
      );
    };
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: expectedCode,
    });
    expect(state.content.get("Target.md")).toBe("after target");
    expect(state.content.get("z.md")).toBe("before z");
    expect(JSON.stringify(result)).not.toContain("private write detail");
  });

  it("returns the full recovery snapshot when progress journal and fallback save fail", async () => {
    const state = harness({
      "Target.md": "before target",
      "a.md": "before a",
      "z.md": "before z",
    });
    let saves = 0;
    state.journal.save = async () => {
      saves += 1;
      if (saves >= 2) throw new Error("secret journal detail");
    };
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "journal-error",
      code: "journal-error",
    });
    expect(result.operation).toMatchObject({
      state: "recovery-required",
      completedPaths: ["Target.md"],
    });
    expect(result.operation.files).toHaveLength(3);
    expect(state.content.get("Target.md")).toBe("after target");
    expect(state.content.get("a.md")).toBe("before a");
  });

  it("is idempotent when the same preview identity already has a durable completed journal", async () => {
    const state = harness({});
    const completed = completedOperation();
    state.journal.load = async () => completed;
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result.kind).toBe("completed");
    expect(state.events).toEqual([]);
  });

  it("replays the completed result of a first execution without Vault access", async () => {
    const state = harness({
      "Target.md": "before target",
      "a.md": "before a",
      "z.md": "before z",
    });
    const first = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(first.kind).toBe("completed");
    state.journal.load = async () => first.operation;
    state.events.length = 0;

    const replay = await executePersistedOperation(first.operation, {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });

    expect(replay.kind).toBe("completed");
    expect(state.events).toEqual([]);
  });

  it.each([
    ["missing", null],
    ["previewed", operation()],
    ["started", operation("applying")],
    [
      "identity mismatch",
      {
        ...completedOperation(),
        files: [
          {
            ...fileChange("Target.md", "before target", "different", "target"),
          },
          ...completedOperation().files.slice(1),
        ],
      },
    ],
  ])(
    "rejects completed caller replay against %s durable state",
    async (_label, durable) => {
      const state = harness({});
      state.journal.load = async () => durable;
      const result = await executePersistedOperation(completedOperation(), {
        vault: state.vault,
        journal: state.journal,
        hashText,
      });
      expect(result).toMatchObject({
        kind: "recovery-required",
        code: "operation-conflict",
      });
      expect(state.events).toEqual([]);
    },
  );

  it.each([
    ["applying caller state", () => operation("applying")],
    ["restored caller state", () => operation("restored")],
    [
      "duplicate paths",
      () => {
        const value = operation();
        return {
          ...value,
          files: [
            value.files[0]!,
            { ...value.files[1]!, path: "Target.md" },
            value.files[2]!,
          ],
        };
      },
    ],
    [
      "empty path",
      () => {
        const value = operation();
        return {
          ...value,
          files: [{ ...value.files[0]!, path: "" }, ...value.files.slice(1)],
        };
      },
    ],
    [
      "target after link",
      () => {
        const value = operation();
        return {
          ...value,
          files: [value.files[1]!, value.files[0]!, value.files[2]!],
        };
      },
    ],
    [
      "unsorted links",
      () => {
        const value = operation();
        return {
          ...value,
          files: [value.files[0]!, value.files[2]!, value.files[1]!],
        };
      },
    ],
    [
      "preview progress",
      () => ({ ...operation(), completedPaths: ["Target.md"] }),
    ],
    [
      "duplicate progress",
      () => ({ ...operation(), completedPaths: ["Target.md", "Target.md"] }),
    ],
    [
      "no-op image",
      () => {
        const value = operation();
        return {
          ...value,
          files: [
            {
              ...value.files[0]!,
              afterHash: "hash:before target",
            },
            ...value.files.slice(1),
          ],
        };
      },
    ],
  ])(
    "rejects invalid operation structure before journal or Vault access: %s",
    async (_label, makeInvalid) => {
      const state = harness({});
      let loads = 0;
      state.journal.load = async () => {
        loads += 1;
        return null;
      };
      const result = await executePersistedOperation(makeInvalid(), {
        vault: state.vault,
        journal: state.journal,
        hashText,
      });
      expect(result).toMatchObject({
        kind: "recovery-required",
        code: "operation-invalid",
      });
      expect(loads).toBe(0);
      expect(state.events).toEqual([]);
    },
  );

  it("returns a stable result when current-image hashing throws", async () => {
    const state = harness({
      "Target.md": "before target",
      "a.md": "before a",
      "z.md": "before z",
    });
    let loads = 0;
    state.journal.load = async () => {
      loads += 1;
      return null;
    };
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText: async () => {
        throw new Error("private hash detail");
      },
    });
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "source-read-error",
    });
    expect(JSON.stringify(result)).not.toContain("private hash detail");
    expect(loads).toBe(1);
    expect(state.events).toEqual(["read:Target.md", "read:a.md", "read:z.md"]);
  });

  it("does not throw when a runtime operation has a malformed shape", async () => {
    const state = harness({});
    const malformed = {
      ...operation(),
      files: undefined,
    } as unknown as PersistedOperation;
    const result = await executePersistedOperation(malformed, {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "operation-invalid",
    });
    expect(state.events).toEqual([]);
  });

  it("rejects an edit whose inverse no longer matches", async () => {
    const state = harness({});
    const original = operation();
    const forged = {
      ...original,
      files: [
        { ...original.files[0]!, inverseEdits: [] },
        ...original.files.slice(1),
      ],
    };
    const result = await executePersistedOperation(forged, {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "operation-invalid",
    });
    expect(state.events).toEqual([]);
  });

  it("rejects a durable journal whose immutable identity differs from the preview caller", async () => {
    const state = harness({});
    const durable = operation("applying");
    state.journal.load = async () => ({
      ...durable,
      files: [
        {
          ...fileChange("Target.md", "before target", "different", "target"),
        },
        ...durable.files.slice(1),
      ],
    });
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "operation-conflict",
    });
    expect(result.operation.files[0]?.afterHash).toBe("hash:different");
    expect(state.events).toEqual([]);
  });
});

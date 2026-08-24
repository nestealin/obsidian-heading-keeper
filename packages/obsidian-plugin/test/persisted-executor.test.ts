import { describe, expect, it } from "vitest";
import { executePersistedOperation } from "../src/persistence/executor.js";
import type {
  JournalStore,
  PersistedOperation,
  VaultFileAdapter,
} from "../src/persistence/types.js";

const hashText = async (text: string) => `hash:${text}`;

function operation(
  state: PersistedOperation["state"] = "previewed",
): PersistedOperation {
  return {
    id: "op-1",
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
    ],
    completedPaths: [],
  };
}

function harness(initial: Record<string, string>) {
  const content = new Map(Object.entries(initial));
  const events: string[] = [];
  const saves: PersistedOperation[] = [];
  const vault: VaultFileAdapter = {
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
    ["readback-mismatch", "readback"],
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
    const completed: PersistedOperation = {
      ...operation("completed"),
      completedPaths: ["Target.md", "a.md", "z.md"],
    };
    state.journal.load = async () => completed;
    const result = await executePersistedOperation(operation(), {
      vault: state.vault,
      journal: state.journal,
      hashText,
    });
    expect(result.kind).toBe("completed");
    expect(state.events).toEqual([]);
  });

  it.each([
    ["non-preview caller state", () => operation("completed")],
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
      "forged image hash",
      () => {
        const value = operation();
        return {
          ...value,
          files: [
            { ...value.files[0]!, afterHash: "forged" },
            ...value.files.slice(1),
          ],
        };
      },
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
              afterText: "before target",
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

  it("returns a stable journal-free result when operation hashing throws", async () => {
    const state = harness({});
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
      code: "operation-hash-error",
    });
    expect(JSON.stringify(result)).not.toContain("private hash detail");
    expect(loads).toBe(0);
    expect(state.events).toEqual([]);
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

  it("recomputes every before and after hash before rejecting an image mismatch", async () => {
    const state = harness({});
    const original = operation();
    const forged = {
      ...original,
      files: [
        { ...original.files[0]!, afterHash: "forged" },
        ...original.files.slice(1),
      ],
    };
    let hashes = 0;
    const result = await executePersistedOperation(forged, {
      vault: state.vault,
      journal: state.journal,
      hashText: async (text) => {
        hashes += 1;
        return `hash:${text}`;
      },
    });
    expect(result).toMatchObject({
      kind: "recovery-required",
      code: "operation-invalid",
    });
    expect(hashes).toBe(6);
    expect(state.events).toEqual([]);
  });

  it("rejects a durable journal whose immutable identity differs from the preview caller", async () => {
    const state = harness({});
    const durable = operation("applying");
    state.journal.load = async () => ({
      ...durable,
      files: [
        {
          ...durable.files[0]!,
          afterText: "different",
          afterHash: "hash:different",
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
    expect(result.operation.files[0]?.afterText).toBe("different");
    expect(state.events).toEqual([]);
  });
});

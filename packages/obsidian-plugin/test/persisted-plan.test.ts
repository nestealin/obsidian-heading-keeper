import {
  buildNumberingPlan,
  DEFAULT_SETTINGS,
  scanHeadings,
} from "@heading-keeper/core";
import { describe, expect, it } from "vitest";
import {
  buildLinkOnlyOperation,
  buildPersistedOperation,
  PersistedPlanError,
  sha256Text,
} from "../src/persistence/plan-service.js";
import { applyCheckedEdits } from "../src/persistence/edits.js";
import type { PlannedFileChange } from "../src/persistence/types.js";

const dependencies = {
  createId: () => "op-1",
  now: () => "2026-08-25T00:00:00.000Z",
  hashText: async (text: string) => `hash:${text}`,
};

function targetInput(beforeText: string) {
  return {
    path: "Target.md",
    beforeText,
    numberingPlan: buildNumberingPlan(
      scanHeadings(beforeText),
      DEFAULT_SETTINGS,
    ),
    numberingMaterialization: "insert" as const,
    linkEdits: [],
  };
}

function after(beforeText: string, file: PlannedFileChange | undefined) {
  if (!file) throw new Error("missing planned file");
  return applyCheckedEdits(beforeText, file.edits);
}

describe("buildPersistedOperation", () => {
  it("persists only hashes and minimal edits, never complete note bodies", async () => {
    const beforeText = "## Private heading\nprivate body marker\n";
    const result = await buildPersistedOperation(
      { target: targetInput(beforeText), linkSources: [] },
      { ...dependencies, hashText: sha256Text },
    );

    expect(result.kind).toBe("operation");
    if (result.kind !== "operation") return;
    const serialized = JSON.stringify(result.operation);
    expect(serialized).not.toContain('"beforeText"');
    expect(serialized).not.toContain('"afterText"');
    expect(serialized).not.toContain("private body marker");
    expect(result.operation.files[0]).toMatchObject({
      edits: [
        {
          range: { from: 3, to: 3 },
          expectedText: "",
          replacementText: "1. ",
        },
      ],
      inverseEdits: [
        {
          range: { from: 3, to: 6 },
          expectedText: "1. ",
          replacementText: "",
        },
      ],
    });
  });

  it("returns an explicit no-op without allocating identity or hashes", async () => {
    let dependencyCalls = 0;
    const beforeText = "## 1. Existing\n";
    const result = await buildPersistedOperation(
      {
        target: {
          path: "Target.md",
          beforeText,
          numberingPlan: buildNumberingPlan(
            scanHeadings(beforeText),
            DEFAULT_SETTINGS,
          ),
          numberingMaterialization: "insert",
          linkEdits: [],
        },
        linkSources: [],
      },
      {
        createId: () => {
          dependencyCalls += 1;
          return "op-1";
        },
        now: () => {
          dependencyCalls += 1;
          return "2026-08-25T00:00:00.000Z";
        },
        hashText: async () => {
          dependencyCalls += 1;
          return "unused";
        },
      },
    );

    expect(result).toEqual({ kind: "no-op" });
    expect(dependencyCalls).toBe(0);
  });

  it("builds an immutable target-first operation and merges same-file link edits", async () => {
    const beforeTarget = "## Title\r\nSee [[#Title]].\r\n";
    const refsBefore = "[[Target#Title]] and [[Target#Title]]";
    const result = await buildPersistedOperation(
      {
        target: {
          ...targetInput(beforeTarget),
          linkEdits: [
            {
              range: { from: 17, to: 22 },
              expectedText: "Title",
              replacementText: "1. Title",
            },
          ],
        },
        linkSources: [
          {
            path: "z.md",
            beforeText: refsBefore,
            edits: [
              {
                range: { from: 9, to: 14 },
                expectedText: "Title",
                replacementText: "1. Title",
              },
            ],
          },
          {
            path: "a.md",
            beforeText: "[[Target#Title]]",
            edits: [
              {
                range: { from: 9, to: 14 },
                expectedText: "Title",
                replacementText: "1. Title",
              },
            ],
          },
          {
            path: "z.md",
            beforeText: refsBefore,
            edits: [
              {
                range: { from: 30, to: 35 },
                expectedText: "Title",
                replacementText: "1. Title",
              },
            ],
          },
        ],
      },
      dependencies,
    );

    expect(result.kind).toBe("operation");
    if (result.kind !== "operation") return;
    expect(result.operation).toMatchObject({
      id: "op-1",
      createdAt: "2026-08-25T00:00:00.000Z",
      state: "previewed",
      completedPaths: [],
      files: [
        {
          path: "Target.md",
          role: "target",
          beforeHash: `hash:${beforeTarget}`,
          afterHash: "hash:## 1. Title\r\nSee [[#1. Title]].\r\n",
        },
        {
          path: "a.md",
          role: "link-source",
          beforeHash: "hash:[[Target#Title]]",
          afterHash: "hash:[[Target#1. Title]]",
        },
        {
          path: "z.md",
          role: "link-source",
          beforeHash: `hash:${refsBefore}`,
          afterHash: "hash:[[Target#1. Title]] and [[Target#1. Title]]",
        },
      ],
    });
    expect(after(beforeTarget, result.operation.files[0])).toBe(
      "## 1. Title\r\nSee [[#1. Title]].\r\n",
    );
    expect(after("[[Target#Title]]", result.operation.files[1])).toBe(
      "[[Target#1. Title]]",
    );
    expect(after(refsBefore, result.operation.files[2])).toBe(
      "[[Target#1. Title]] and [[Target#1. Title]]",
    );
    expect(Object.isFrozen(result.operation)).toBe(true);
    expect(Object.isFrozen(result.operation.files)).toBe(true);
    expect(Object.isFrozen(result.operation.files[0])).toBe(true);
  });

  it("sorts link paths by deterministic code-unit order", async () => {
    const edit = {
      range: { from: 0, to: 1 },
      expectedText: "x",
      replacementText: "y",
    };
    const result = await buildPersistedOperation(
      {
        target: targetInput("## 1. Existing\n"),
        linkSources: ["ä.md", "a.md", "Z.md"].map((path) => ({
          path,
          beforeText: "x",
          edits: [edit],
        })),
      },
      dependencies,
    );
    expect(
      result.kind === "operation" &&
        result.operation.files.map((file) => file.path),
    ).toEqual(["Z.md", "a.md", "ä.md"]);
  });

  it.each([
    [
      "range-invalid",
      { range: { from: -1, to: 1 }, expectedText: "#", replacementText: "x" },
    ],
    [
      "expected-text-mismatch",
      { range: { from: 0, to: 1 }, expectedText: "x", replacementText: "y" },
    ],
  ])("rejects invalid verified edits with %s", async (code, edit) => {
    await expect(
      buildPersistedOperation(
        {
          target: { ...targetInput("## Title\n"), linkEdits: [edit] },
          linkSources: [],
        },
        dependencies,
      ),
    ).rejects.toMatchObject({ name: "PersistedPlanError", code });
  });

  it("rejects overlapping same-file edits", async () => {
    await expect(
      buildPersistedOperation(
        {
          target: targetInput("## Title\n"),
          linkSources: [
            {
              path: "Refs.md",
              beforeText: "abcdef",
              edits: [
                {
                  range: { from: 1, to: 4 },
                  expectedText: "bcd",
                  replacementText: "x",
                },
                {
                  range: { from: 3, to: 5 },
                  expectedText: "de",
                  replacementText: "y",
                },
              ],
            },
          ],
        },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(PersistedPlanError);
  });

  it("validates numbering without materializing insertions for remove plans", async () => {
    const beforeText = "## 1. Alpha\n## Beta\n";
    const result = await buildPersistedOperation(
      {
        target: {
          ...targetInput(beforeText),
          numberingMaterialization: "validate-only",
          linkEdits: [
            {
              range: { from: 3, to: 6 },
              expectedText: "1. ",
              replacementText: "",
            },
          ],
        },
        linkSources: [],
      },
      dependencies,
    );

    expect(result.kind).toBe("operation");
    if (result.kind !== "operation") return;
    expect(after(beforeText, result.operation.files[0])).toBe(
      "## Alpha\n## Beta\n",
    );
  });

  it("rejects forged target plans", async () => {
    const target = targetInput("## Title\n");
    target.numberingPlan.entries[0]!.edit!.replacementText = "# forged";
    await expect(
      buildPersistedOperation({ target, linkSources: [] }, dependencies),
    ).rejects.toMatchObject({ code: "invalid-target-plan" });
  });

  it("captures inputs before asynchronous hashing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const source = {
      path: "Refs.md",
      beforeText: "[[Target#Title]]",
      edits: [
        {
          range: { from: 9, to: 14 },
          expectedText: "Title",
          replacementText: "1. Title",
        },
      ],
    };
    const resultPromise = buildPersistedOperation(
      { target: targetInput("## Title\n"), linkSources: [source] },
      {
        ...dependencies,
        hashText: async (text) => {
          await gate;
          return `hash:${text}`;
        },
      },
    );
    source.beforeText = "mutated";
    source.edits[0]!.replacementText = "mutated";
    release();
    const result = await resultPromise;
    expect(
      result.kind === "operation" &&
        after("[[Target#Title]]", result.operation.files[1]),
    ).toBe("[[Target#1. Title]]");
  });

  it("uses Web Crypto SHA-256 for Unicode CRLF text", async () => {
    await expect(sha256Text("中文 🐙\r\n")).resolves.toBe(
      "bd2326ac7d5e1ab81d811c5f869d23334a3964beda51e7109d0b4118ef7b3549",
    );
  });
});

describe("buildLinkOnlyOperation", () => {
  it("builds a sorted journaled operation without rewriting a target file", async () => {
    const result = await buildLinkOnlyOperation(
      {
        linkSources: ["z.md", "a.md"].map((path) => ({
          path,
          beforeText: "[[Target#Old]]",
          edits: [
            {
              range: { from: 9, to: 12 },
              expectedText: "Old",
              replacementText: "New",
            },
          ],
        })),
      },
      dependencies,
    );

    expect(result.kind).toBe("operation");
    if (result.kind !== "operation") return;
    expect(result.operation.files).toEqual([
      expect.objectContaining({
        path: "a.md",
        role: "link-source",
      }),
      expect.objectContaining({
        path: "z.md",
        role: "link-source",
      }),
    ]);
    expect(
      result.operation.files.map((file) => after("[[Target#Old]]", file)),
    ).toEqual(["[[Target#New]]", "[[Target#New]]"]);
    expect(result.operation.files.some((file) => file.role === "target")).toBe(
      false,
    );
  });

  it("returns no-op without allocating identity for empty link changes", async () => {
    let calls = 0;
    await expect(
      buildLinkOnlyOperation(
        { linkSources: [] },
        {
          createId: () => {
            calls += 1;
            return "unused";
          },
          now: () => {
            calls += 1;
            return "unused";
          },
          hashText: async () => {
            calls += 1;
            return "unused";
          },
        },
      ),
    ).resolves.toEqual({ kind: "no-op" });
    expect(calls).toBe(0);
  });
});

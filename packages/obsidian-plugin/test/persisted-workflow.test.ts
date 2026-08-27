import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import { sha256Text } from "../src/persistence/plan-service.js";
import { buildWorkflowPreview } from "../src/persisted-workflow.js";
import { applyCheckedEdits } from "../src/persistence/edits.js";
import type { PlannedFileChange } from "../src/persistence/types.js";

const settings = { ...DEFAULT_STORED_SETTINGS, mode: "persisted" as const };
const deps = {
  createId: () => "plan-1",
  now: () => "2026-08-25T00:00:00.000Z",
  hashText: sha256Text,
};

function after(beforeText: string, file: PlannedFileChange | undefined) {
  if (!file) throw new Error("missing planned file");
  return applyCheckedEdits(beforeText, file.edits);
}

describe("buildWorkflowPreview", () => {
  it("builds global target and link-source edits for wiki and markdown links", async () => {
    const result = await buildWorkflowPreview(
      {
        kind: "add",
        targetPath: "Target.md",
        sources: [
          { path: "Target.md", text: "# Outside\n## Alpha\n### Beta" },
          {
            path: "Links.md",
            text: '[[Target#Alpha|keep]] and [B](Target.md#Beta "title")',
          },
        ],
        settings,
        resolveTarget: () => ({ kind: "file", path: "Target.md" }),
      },
      deps,
    );

    expect(result.kind).toBe("preview");
    if (result.kind !== "preview") return;
    expect(result.planId).toBe("plan-1");
    expect(
      result.operation.files.map(({ path, role }) => ({ path, role })),
    ).toEqual([
      { path: "Target.md", role: "target" },
      { path: "Links.md", role: "link-source" },
    ]);
    expect(
      after("# Outside\n## Alpha\n### Beta", result.operation.files[0]),
    ).toBe("# Outside\n## 1. Alpha\n### 1.1. Beta");
    expect(
      after(
        '[[Target#Alpha|keep]] and [B](Target.md#Beta "title")',
        result.operation.files[1],
      ),
    ).toBe('[[Target#1. Alpha|keep]] and [B](Target.md#1.1.%20Beta "title")');
    expect(result.groups.targetEdits).toHaveLength(2);
    expect(result.groups.linkSources).toEqual([
      {
        path: "Links.md",
        edits: [
          {
            range: { from: 0, to: 21 },
            expectedText: "[[Target#Alpha|keep]]",
            replacementText: "[[Target#1. Alpha|keep]]",
          },
          {
            range: { from: 26, to: 53 },
            expectedText: '[B](Target.md#Beta "title")',
            replacementText: '[B](Target.md#1.1.%20Beta "title")',
          },
        ],
      },
    ]);
    expect(result.groups.recoveryBoundary).toEqual([
      "source-hash-preflight",
      "external-change-preserved",
    ]);
  });

  it("keeps same-target heading-link edits in the complete preview", async () => {
    const result = await buildWorkflowPreview(
      {
        kind: "add",
        targetPath: "Target.md",
        sources: [{ path: "Target.md", text: "## Alpha\n[[#Alpha]]" }],
        settings,
        resolveTarget: (sourcePath, linkPath) => {
          expect([sourcePath, linkPath]).toEqual(["Target.md", ""]);
          return { kind: "file", path: "Target.md" };
        },
      },
      deps,
    );

    expect(result.kind).toBe("preview");
    if (result.kind !== "preview") return;
    expect(result.operation.files).toHaveLength(1);
    expect(after("## Alpha\n[[#Alpha]]", result.operation.files[0])).toBe(
      "## 1. Alpha\n[[#1. Alpha]]",
    );
    expect(result.groups.targetEdits).toHaveLength(1);
    expect(result.groups.linkSources).toEqual([
      {
        path: "Target.md",
        edits: [
          {
            range: { from: 9, to: 19 },
            expectedText: "[[#Alpha]]",
            replacementText: "[[#1. Alpha]]",
          },
        ],
      },
    ]);
  });

  it.each([
    ["Wiki", "## Alpha\n## [[#Alpha]]", "## 1. Alpha\n## 2. [[#1. Alpha]]"],
    [
      "Markdown",
      "## Alpha\n## [Alpha](#Alpha)",
      "## 1. Alpha\n## 2. [Alpha](#1.%20Alpha)",
    ],
  ])(
    "composes numbering with a %s heading link nested inside heading text",
    async (_syntax, beforeText, numberedText) => {
      const resolveTarget = (sourcePath: string, linkPath: string) => {
        expect([sourcePath, linkPath]).toEqual(["Target.md", ""]);
        return { kind: "file" as const, path: "Target.md" };
      };
      const added = await buildWorkflowPreview(
        {
          kind: "add",
          targetPath: "Target.md",
          sources: [{ path: "Target.md", text: beforeText }],
          settings,
          resolveTarget,
        },
        deps,
      );

      expect(added.kind).toBe("preview");
      if (added.kind !== "preview") return;
      expect(added.operation.files).toHaveLength(1);
      expect(after(beforeText, added.operation.files[0])).toBe(numberedText);
      expect(added.groups.targetEdits).toHaveLength(2);
      expect(added.groups.linkSources).toHaveLength(1);

      const removed = await buildWorkflowPreview(
        {
          kind: "remove",
          targetPath: "Target.md",
          sources: [{ path: "Target.md", text: numberedText }],
          settings,
          resolveTarget,
        },
        deps,
      );

      expect(removed.kind).toBe("preview");
      if (removed.kind !== "preview") return;
      expect(removed.operation.files).toHaveLength(1);
      expect(after(numberedText, removed.operation.files[0])).toBe(beforeText);
      expect(removed.groups.targetEdits).toHaveLength(2);
      expect(removed.groups.linkSources).toHaveLength(1);
    },
  );

  it("returns no-op for a note with no safely owned changes", async () => {
    const result = await buildWorkflowPreview(
      {
        kind: "add",
        targetPath: "Target.md",
        sources: [{ path: "Target.md", text: "# Outside" }],
        settings,
        resolveTarget: () => ({ kind: "missing" }),
      },
      deps,
    );

    expect(result).toMatchObject({ kind: "no-op" });
  });

  it("preserves missing and ambiguous targets as grouped diagnostics", async () => {
    const result = await buildWorkflowPreview(
      {
        kind: "add",
        targetPath: "Target.md",
        sources: [
          { path: "Target.md", text: "## Alpha" },
          { path: "Links.md", text: "[[Missing#Alpha]] [[Maybe#Alpha]]" },
        ],
        settings,
        resolveTarget: (_source, linkPath) =>
          linkPath === "Missing"
            ? { kind: "missing" }
            : { kind: "ambiguous", paths: ["A.md", "B.md"] },
      },
      deps,
    );

    expect(result.kind).toBe("preview");
    if (result.kind !== "preview") return;
    expect(result.groups.preserved.map(({ code }) => code)).toEqual([
      "target-missing",
      "target-ambiguous",
    ]);
    expect(result.operation.files).toHaveLength(1);
  });

  it("keeps workflow diagnostics scoped to current renames without changing edit files or order", async () => {
    const result = await buildWorkflowPreview(
      {
        kind: "add",
        targetPath: "Target.md",
        sources: [
          { path: "Target.md", text: "## Alpha" },
          {
            path: "Links.md",
            text: [
              "[[Target#Alpha]]",
              "[[Target#^block]]",
              "[[Missing#Alpha]]",
              "[[Missing#Unrelated]]",
              "[[Target]]",
              "[web](https://example.com/#Alpha)",
            ].join(" "),
          },
          { path: "Unrelated.md", text: "[[Missing#Elsewhere]]" },
        ],
        settings,
        resolveTarget: (_source, linkPath) =>
          linkPath === "Target"
            ? { kind: "file", path: "Target.md" }
            : { kind: "missing" },
      },
      deps,
    );

    expect(result.kind).toBe("preview");
    if (result.kind !== "preview") return;
    expect(
      result.operation.files.map(({ path, role }) => ({ path, role })),
    ).toEqual([
      { path: "Target.md", role: "target" },
      { path: "Links.md", role: "link-source" },
    ]);
    expect(result.groups.linkSources).toEqual([
      {
        path: "Links.md",
        edits: [
          {
            range: { from: 0, to: 16 },
            expectedText: "[[Target#Alpha]]",
            replacementText: "[[Target#1. Alpha]]",
          },
        ],
      },
    ]);
    expect(result.groups.preserved).toEqual([
      { path: "Links.md", code: "block-reference" },
      { path: "Links.md", code: "target-missing" },
    ]);
  });

  it("retains a related block-reference-only source in workflow diagnostics", async () => {
    const result = await buildWorkflowPreview(
      {
        kind: "add",
        targetPath: "Target.md",
        sources: [
          { path: "Target.md", text: "## Alpha" },
          { path: "Blocks.md", text: "[[Target#^block]]" },
        ],
        settings,
        resolveTarget: () => ({ kind: "file", path: "Target.md" }),
      },
      deps,
    );

    expect(result.kind).toBe("preview");
    if (result.kind !== "preview") return;
    expect(result.operation.files.map(({ path }) => path)).toEqual([
      "Target.md",
    ]);
    expect(result.groups.preserved).toEqual([
      { path: "Blocks.md", code: "block-reference" },
    ]);
  });

  it.each([
    ["add", "## Alpha", "[[Target#Alpha]]", "[[Target#1. Alpha]]"],
    ["remove", "## 1. Alpha", "[[Target#1. Alpha]]", "[[Target#Alpha]]"],
  ] as const)(
    "keeps only related malformed diagnostics for %s without changing operation files or edit order",
    async (kind, targetText, editableLink, expectedReplacement) => {
      const result = await buildWorkflowPreview(
        {
          kind,
          targetPath: "Target.md",
          sources: [
            { path: "Target.md", text: targetText },
            {
              path: "Links.md",
              text: [
                editableLink,
                "[[Target#Bad%GG]]",
                "[[Other#Bad%GG]]",
                "[[External#Alpha]]",
                "[[Invalid#Alpha]]",
              ].join(" "),
            },
          ],
          settings,
          resolveTarget: (_source, linkPath) => {
            if (linkPath === "Target")
              return { kind: "file", path: "Target.md" };
            if (linkPath === "Other") return { kind: "file", path: "Other.md" };
            if (linkPath === "External") return { kind: "external" };
            return { kind: "file", path: "../Target.md" };
          },
        },
        deps,
      );

      expect(result.kind).toBe("preview");
      if (result.kind !== "preview") return;
      expect(
        result.operation.files.map(({ path, role }) => ({ path, role })),
      ).toEqual([
        { path: "Target.md", role: "target" },
        { path: "Links.md", role: "link-source" },
      ]);
      expect(result.groups.linkSources).toEqual([
        {
          path: "Links.md",
          edits: [
            expect.objectContaining({
              expectedText: editableLink,
              replacementText: expectedReplacement,
            }),
          ],
        },
      ]);
      expect(result.groups.preserved).toEqual([
        { path: "Links.md", code: "malformed-percent-encoding" },
      ]);
    },
  );

  it("removes only the exact current prefix while preserving closing syntax and CRLF", async () => {
    const result = await buildWorkflowPreview(
      {
        kind: "remove",
        targetPath: "Target.md",
        sources: [
          {
            path: "Target.md",
            text: "## 1. Alpha  ##\r\n### 1.1. Beta\r\n## 2026 plan",
          },
          { path: "Links.md", text: "[[Target#1. Alpha|alias]]" },
        ],
        settings,
        resolveTarget: () => ({ kind: "file", path: "Target.md" }),
      },
      deps,
    );

    expect(result.kind).toBe("preview");
    if (result.kind !== "preview") return;
    expect(
      after(
        "## 1. Alpha  ##\r\n### 1.1. Beta\r\n## 2026 plan",
        result.operation.files[0],
      ),
    ).toBe("## Alpha  ##\r\n### Beta\r\n## 2026 plan");
    expect(after("[[Target#1. Alpha|alias]]", result.operation.files[1])).toBe(
      "[[Target#Alpha|alias]]",
    );
    expect(result.groups.preserved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "semantic-prefix" }),
      ]),
    );
  });

  it("does not materialize add edits while removing mixed heading ownership", async () => {
    const beforeText = [
      "# Outside",
      "## 1. Alpha",
      "## Beta",
      "## 2026. Roadmap",
      "## 9. Old candidate",
    ].join("\n");
    const result = await buildWorkflowPreview(
      {
        kind: "remove",
        targetPath: "Target.md",
        sources: [{ path: "Target.md", text: beforeText }],
        settings,
        resolveTarget: () => ({ kind: "file", path: "Target.md" }),
      },
      deps,
    );

    expect(result.kind).toBe("preview");
    if (result.kind !== "preview") return;
    expect(result.groups.targetEdits).toEqual([
      {
        range: { from: 13, to: 16 },
        expectedText: "1. ",
        replacementText: "",
      },
      {
        range: { from: 50, to: 53 },
        expectedText: "9. ",
        replacementText: "",
      },
    ]);
    expect(result.operation.files).toHaveLength(1);
    expect(after(beforeText, result.operation.files[0])).toBe(
      [
        "# Outside",
        "## Alpha",
        "## Beta",
        "## 2026. Roadmap",
        "## Old candidate",
      ].join("\n"),
    );
    expect(result.groups.preserved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "semantic-prefix" }),
      ]),
    );
    expect(result.groups.skips).toEqual([
      expect.objectContaining({ code: "heading-outside-range" }),
    ]);
  });

  it("uses stable skip codes instead of planner sentences", async () => {
    const result = await buildWorkflowPreview(
      {
        kind: "add",
        targetPath: "Target.md",
        sources: [{ path: "Target.md", text: "# Outside\n### Orphan" }],
        settings,
        resolveTarget: () => ({ kind: "missing" }),
      },
      deps,
    );

    expect(result.groups.skips.map(({ code }) => code)).toEqual([
      "heading-outside-range",
      "heading-missing-top-level",
    ]);
    expect(
      result.groups.skips.some(({ code }) => code.includes("Heading")),
    ).toBe(false);
  });
});

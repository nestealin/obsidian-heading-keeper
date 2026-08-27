import { describe, expect, it } from "vitest";
import {
  auditHeadingLinks,
  buildRepairPlan,
  type HeadingLinkRepairSelection,
} from "../src/index.js";

function audit(sources: Array<{ path: string; text: string }>) {
  return auditHeadingLinks({
    sources,
    resolveTarget: (_sourcePath, linkPath) =>
      linkPath === "Ambiguous"
        ? { kind: "ambiguous", paths: ["A.md", "B.md"] }
        : { kind: "file", path: "Target.md" },
  });
}

describe("buildRepairPlan", () => {
  it.each([
    ["Wiki", "[[Target#Old|alias]]", "[[Target#New|alias]]"],
    [
      "Markdown",
      '[label](Target.md#Old "title")',
      '[label](Target.md#New "title")',
    ],
  ])(
    "builds an exact %s repair for an explicitly selected heading",
    (_kind, link, expected) => {
      const sources = [
        { path: "Target.md", text: "## New" },
        { path: "Refs.md", text: link },
      ];
      const result = audit(sources);
      const finding = result.findings[0]!;
      const plan = buildRepairPlan({
        sources,
        findings: result.findings,
        selections: [
          { findingId: finding.id, targetPath: "Target.md", heading: "New" },
        ],
      });

      expect(plan).toEqual({
        kind: "plan",
        edits: [
          expect.objectContaining({
            sourcePath: "Refs.md",
            expectedText: link,
            replacementText: expected,
          }),
        ],
      });
    },
  );

  it("requires an explicit target and heading for an ambiguous target", () => {
    const sources = [
      { path: "A.md", text: "## Alpha" },
      { path: "B.md", text: "## Beta" },
      { path: "Refs.md", text: "[[Ambiguous#Old]]" },
    ];
    const result = audit(sources);
    const finding = result.findings[0]!;
    expect(finding.candidates).toEqual([
      { targetPath: "A.md", headings: ["Alpha"] },
      { targetPath: "B.md", headings: ["Beta"] },
    ]);

    const plan = buildRepairPlan({
      sources,
      findings: result.findings,
      selections: [
        { findingId: finding.id, targetPath: "B.md", heading: "Beta" },
      ],
    });
    expect(plan.kind).toBe("plan");
    if (plan.kind !== "plan") return;
    expect(plan.edits[0]?.replacementText).toBe("[[B#Beta]]");
  });

  it.each([
    ["stale source", "source-stale"],
    ["duplicate selection", "selection-duplicate"],
    ["invalid candidate", "selection-invalid"],
  ])("rejects %s without producing a writable plan", (scenario, code) => {
    const auditedSources = [
      { path: "Target.md", text: "## New" },
      { path: "Refs.md", text: "[[Target#Old]]" },
    ];
    const finding = audit(auditedSources).findings[0]!;
    const valid: HeadingLinkRepairSelection = {
      findingId: finding.id,
      targetPath: "Target.md",
      heading: "New",
    };
    const sources =
      scenario === "stale source"
        ? [
            auditedSources[0]!,
            { path: "Refs.md", text: "prefix [[Target#Old]]" },
          ]
        : auditedSources;
    const selections =
      scenario === "duplicate selection"
        ? [valid, valid]
        : scenario === "invalid candidate"
          ? [{ ...valid, heading: "Guessed" }]
          : [valid];

    const plan = buildRepairPlan({ sources, findings: [finding], selections });
    expect(plan).toMatchObject({
      kind: "invalid",
      diagnostics: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });

  it("never audits or repairs protected literal links", () => {
    const sources = [
      { path: "Target.md", text: "## New" },
      { path: "Refs.md", text: "`[[Target#Old]]`" },
    ];
    const result = audit(sources);
    expect(result.findings).toEqual([]);
    expect(buildRepairPlan({ sources, findings: [], selections: [] })).toEqual({
      kind: "plan",
      edits: [],
    });
  });
});

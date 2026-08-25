import { describe, expect, it } from "vitest";
import { auditHeadingLinks, type HeadingLinkAuditCode } from "../src/index.js";

const sources = [
  { path: "Target.md", text: "## Existing\n## Duplicate\n### Duplicate\n" },
  {
    path: "Refs.md",
    text: [
      "[[Target#Existing]]",
      "[[Target#Missing]]",
      "[[Target#Duplicate]]",
      "[[Missing#Whatever]]",
      "[[Target#Bad%GG]]",
      "[[Target#^block]]",
      "[web](https://example.com/#Missing)",
      "`[[Target#Missing]]`",
    ].join("\n"),
  },
];

describe("auditHeadingLinks", () => {
  it("reports deterministic broken, ambiguous, malformed, and skipped heading identities", () => {
    const result = auditHeadingLinks({
      sources: [...sources].reverse(),
      resolveTarget: (_sourcePath, linkPath) =>
        linkPath === "Missing"
          ? { kind: "missing" }
          : { kind: "file", path: "Target.md" },
    });

    expect(result.scannedLinks).toBe(6);
    expect(
      result.findings.map(({ sourcePath, code, fragment }) => ({
        sourcePath,
        code,
        fragment,
      })),
    ).toEqual([
      { sourcePath: "Refs.md", code: "heading-missing", fragment: "Missing" },
      {
        sourcePath: "Refs.md",
        code: "heading-duplicate",
        fragment: "Duplicate",
      },
      { sourcePath: "Refs.md", code: "target-missing", fragment: "Whatever" },
      {
        sourcePath: "Refs.md",
        code: "malformed-percent-encoding",
        fragment: "Bad%GG",
      },
      { sourcePath: "Refs.md", code: "block-reference", fragment: "^block" },
    ] satisfies Array<{
      sourcePath: string;
      code: HeadingLinkAuditCode;
      fragment: string;
    }>);
    expect(result.brokenCount).toBe(4);
    expect(result.skippedCount).toBe(1);
  });

  it("supports same-file and NFC/encoded fragments without findings", () => {
    const result = auditHeadingLinks({
      sources: [
        {
          path: "Café.md",
          text: "## Café 标题\n[[#Cafe%CC%81%20%E6%A0%87%E9%A2%98]]\n",
        },
      ],
      resolveTarget: () => ({ kind: "file", path: "Cafe\u0301.md" }),
    });

    expect(result).toEqual({
      scannedLinks: 1,
      brokenCount: 0,
      skippedCount: 0,
      findings: [],
    });
  });

  it("reports resolver and source-identity failures without guessing", () => {
    const codes = [
      auditHeadingLinks({
        sources: [{ path: "Refs.md", text: "[[Target#A]]" }],
        resolveTarget: () => {
          throw new Error("resolver");
        },
      }).findings[0]?.code,
      auditHeadingLinks({
        sources: [{ path: "Refs.md", text: "[[Target#A]]" }],
        resolveTarget: () => ({ kind: "ambiguous", paths: ["A.md", "B.md"] }),
      }).findings[0]?.code,
      auditHeadingLinks({
        sources: [{ path: "Refs.md", text: "[[Target#A]]" }],
        resolveTarget: () => ({ kind: "file", path: "Unindexed.md" }),
      }).findings[0]?.code,
    ];

    expect(codes).toEqual([
      "target-resolution-error",
      "target-ambiguous",
      "target-source-unavailable",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { planHeadingLinkChanges } from "../src/index.js";

describe("planHeadingLinkChanges", () => {
  it("rewrites only a unique resolved heading identity", () => {
    const changes = planHeadingLinkChanges({
      sourcePath: "Refs.md",
      markdown: "[[Target#Old heading]]",
      renames: [
        {
          targetPath: "Target.md",
          oldHeading: "Old heading",
          newHeading: "1. Old heading",
        },
      ],
      resolveTarget: () => ({ kind: "file", path: "Target.md" }),
    });

    expect(changes.edits[0]?.replacement).toBe("[[Target#1. Old heading]]");
  });

  it("uses resolver identities for same-file, cross-file, embeds, and normalized target paths", () => {
    const calls: Array<[string, string]> = [];
    const markdown = [
      "[[#Old heading]]",
      "[[Folder/Target#Old%20heading|alias stays]]",
      "![[Folder/Target#Old heading|embed alias]]",
    ].join(" ");
    const changes = planHeadingLinkChanges({
      sourcePath: "Folder/Refs.md",
      markdown,
      renames: [
        {
          targetPath: "Folder/Target.md",
          oldHeading: "Old heading",
          newHeading: "1. Old heading",
        },
        {
          targetPath: "Folder/Refs.md",
          oldHeading: "Old heading",
          newHeading: "2. Old heading",
        },
      ],
      resolveTarget: (sourcePath, linkPath) => {
        calls.push([sourcePath, linkPath]);
        return linkPath === ""
          ? { kind: "file", path: "Folder/./Refs.md" }
          : { kind: "file", path: "Folder/Nested/../Target.md" };
      },
    });

    expect(calls).toEqual([
      ["Folder/Refs.md", ""],
      ["Folder/Refs.md", "Folder/Target"],
      ["Folder/Refs.md", "Folder/Target"],
    ]);
    expect(changes).toEqual({
      edits: [
        {
          range: { from: 0, to: 16 },
          replacement: "[[#2. Old heading]]",
          targetPath: "Folder/Refs.md",
          reason: "unique-heading-rename",
        },
        {
          range: { from: 17, to: 60 },
          replacement: "[[Folder/Target#1. Old heading|alias stays]]",
          targetPath: "Folder/Target.md",
          reason: "unique-heading-rename",
        },
        {
          range: { from: 61, to: 103 },
          replacement: "![[Folder/Target#1. Old heading|embed alias]]",
          targetPath: "Folder/Target.md",
          reason: "unique-heading-rename",
        },
      ],
      diagnostics: [],
    });
  });

  it("encodes only Markdown fragments and preserves paths, queries, labels, angle style, and titles", () => {
    const markdown = [
      '[label](<../Target file.md?view=1#Cafe%CC%81 标题> "keep title")',
      "![原样 alt](../Target.md#Caf%C3%A9%20标题 '原样 title')",
    ].join("\n");
    const changes = planHeadingLinkChanges({
      sourcePath: "Refs.md",
      markdown,
      renames: [
        {
          targetPath: "Target.md",
          oldHeading: "Café 标题",
          newHeading: "1. Café 标题",
        },
      ],
      resolveTarget: () => ({ kind: "file", path: "Target.md" }),
    });

    expect(changes.edits.map((edit) => edit.replacement)).toEqual([
      '[label](<../Target file.md?view=1#1.%20Caf%C3%A9%20%E6%A0%87%E9%A2%98> "keep title")',
      "![原样 alt](../Target.md#1.%20Caf%C3%A9%20%E6%A0%87%E9%A2%98 '原样 title')",
    ]);
  });

  it("diagnoses protected targets and never asks the resolver to guess them", () => {
    let resolverCalls = 0;
    const changes = planHeadingLinkChanges({
      sourcePath: "Refs.md",
      markdown: [
        "[[Target]]",
        "[[Target#^block]]",
        "[[Target#%5Eblock]]",
        "[web](https://example.com/page#Old)",
        "[cdn](//cdn.example.com/page#Old)",
        "[bad](Target.md#Bad%GG)",
      ].join(" "),
      renames: [],
      resolveTarget: () => {
        resolverCalls += 1;
        return { kind: "missing" };
      },
    });

    expect(resolverCalls).toBe(0);
    expect(changes).toEqual({
      edits: [],
      diagnostics: [
        {
          code: "missing-heading-fragment",
          message: "Link has no heading fragment and was preserved.",
          sourceRange: { from: 0, to: 10 },
        },
        {
          code: "block-reference",
          message: "Block references are not heading rename targets.",
          sourceRange: { from: 11, to: 28 },
        },
        {
          code: "block-reference",
          message: "Block references are not heading rename targets.",
          sourceRange: { from: 29, to: 48 },
        },
        {
          code: "external-link",
          message: "External links are not resolved as vault files.",
          sourceRange: { from: 49, to: 84 },
        },
        {
          code: "external-link",
          message: "External links are not resolved as vault files.",
          sourceRange: { from: 85, to: 118 },
        },
        {
          code: "malformed-percent-encoding",
          message: "Heading fragment contains malformed percent encoding.",
          sourceRange: { from: 119, to: 142 },
        },
      ],
    });
  });

  it("diagnoses missing, ambiguous, and externally resolved targets", () => {
    const markdown = [
      "[[Missing#Old]]",
      "[[Ambiguous#Old]]",
      "[[External#Old]]",
    ].join(" ");
    const changes = planHeadingLinkChanges({
      sourcePath: "Refs.md",
      markdown,
      renames: [],
      resolveTarget: (_sourcePath, linkPath) => {
        if (linkPath === "Missing") return { kind: "missing" };
        if (linkPath === "Ambiguous") {
          return { kind: "ambiguous", paths: ["A.md", "B.md"] };
        }
        return { kind: "external" };
      },
    });

    expect(changes.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "target-missing",
      "target-ambiguous",
      "target-external",
    ]);
    expect(changes.edits).toEqual([]);
  });

  it("refuses duplicate normalized rename identities deterministically", () => {
    const input = {
      sourcePath: "Refs.md",
      markdown: "[[Target#Old heading]] [[Target#Other]]",
      renames: [
        {
          targetPath: "Folder/../Target.md",
          oldHeading: "Old%20heading",
          newHeading: "1. Old heading",
        },
        {
          targetPath: "Target.md",
          oldHeading: "Old heading",
          newHeading: "9. Conflicting",
        },
      ],
      resolveTarget: () => ({ kind: "file" as const, path: "Target.md" }),
    };

    expect(planHeadingLinkChanges(input)).toEqual(
      planHeadingLinkChanges(input),
    );
    expect(planHeadingLinkChanges(input)).toEqual({
      edits: [],
      diagnostics: [
        {
          code: "duplicate-heading-rename",
          message:
            "Multiple renames share the same normalized file and heading identity.",
          sourceRange: { from: 0, to: 22 },
        },
      ],
    });
  });
});

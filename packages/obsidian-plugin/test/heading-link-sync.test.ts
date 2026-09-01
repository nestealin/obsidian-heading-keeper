import { describe, expect, it } from "vitest";
import { buildAutomaticHeadingLinkSync } from "../src/heading-link-sync.js";
import { applyCheckedEdits } from "../src/persistence/edits.js";

const operationDependencies = {
  createId: () => "sync-1",
  now: () => "2026-08-26T00:00:00.000Z",
  hashText: async (text: string) => `hash:${text}`,
};

describe("buildAutomaticHeadingLinkSync", () => {
  it("builds sorted exact-identity link-only changes for one safe rename", async () => {
    const result = await buildAutomaticHeadingLinkSync(
      {
        targetPath: "Target.md",
        beforeText: "## Old title\n",
        afterText: "## New title\nSee [[#Old title|self]].\n",
        sources: [
          {
            path: "z.md",
            text: "[[Target#Old title|alias]] and plain Old title",
          },
          {
            path: "Target.md",
            text: "## New title\nSee [[#Old title|self]].\n",
          },
          {
            path: "a.md",
            text: '[label](Target.md#Old%20title "keep")',
          },
        ],
        resolveTarget: (_sourcePath, linkPath) => ({
          kind: "file",
          path:
            linkPath === "" || linkPath === "Target.md"
              ? "Target.md"
              : `${linkPath}.md`,
        }),
      },
      operationDependencies,
    );

    expect(result.kind).toBe("operation");
    if (result.kind !== "operation") return;
    expect(result.rename).toEqual({
      targetPath: "Target.md",
      oldHeading: "Old title",
      newHeading: "New title",
    });
    expect(result.operation.files.map((file) => file.path)).toEqual([
      "Target.md",
      "a.md",
      "z.md",
    ]);
    const beforeByPath = new Map([
      ["Target.md", "## New title\nSee [[#Old title|self]].\n"],
      ["a.md", '[label](Target.md#Old%20title "keep")'],
      ["z.md", "[[Target#Old title|alias]] and plain Old title"],
    ]);
    expect(
      result.operation.files.map((file) =>
        applyCheckedEdits(beforeByPath.get(file.path)!, file.edits),
      ),
    ).toEqual([
      "## New title\nSee [[#New title|self]].\n",
      '[label](Target.md#New%20title "keep")',
      "[[Target#New title|alias]] and plain Old title",
    ]);
    expect(
      result.operation.files.every((file) => file.role === "link-source"),
    ).toBe(true);
  });

  it("returns the conservative detector reason and performs no planning for compound changes", async () => {
    let resolverCalls = 0;
    const result = await buildAutomaticHeadingLinkSync(
      {
        targetPath: "Target.md",
        beforeText: "## A\n## B\n",
        afterText: "## C\n## D\n",
        sources: [{ path: "Refs.md", text: "[[Target#A]]" }],
        resolveTarget: () => {
          resolverCalls += 1;
          return { kind: "file", path: "Target.md" };
        },
      },
      operationDependencies,
    );

    expect(result).toEqual({
      kind: "unsafe",
      reason: "multiple-heading-changes",
    });
    expect(resolverCalls).toBe(0);
  });

  it("returns no-op when no current source links the old identity", async () => {
    await expect(
      buildAutomaticHeadingLinkSync(
        {
          targetPath: "Target.md",
          beforeText: "## Old\n",
          afterText: "## New\n",
          sources: [{ path: "Refs.md", text: "[[Other#Old]]" }],
          resolveTarget: () => ({ kind: "file", path: "Other.md" }),
        },
        operationDependencies,
      ),
    ).resolves.toEqual({
      kind: "no-op",
      rename: {
        targetPath: "Target.md",
        oldHeading: "Old",
        newHeading: "New",
      },
      diagnostics: [],
    });
  });
});

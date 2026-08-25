import { describe, expect, it } from "vitest";
import { detectSafeHeadingRename } from "../src/index.js";

describe("detectSafeHeadingRename", () => {
  it("detects one unique same-level saved heading rename", () => {
    expect(
      detectSafeHeadingRename(
        "# Page\n\n## Old title\nBody\n### Child\n",
        "# Page\n\n## New title\nChanged body\n### Child\n",
      ),
    ).toEqual({
      kind: "safe",
      rename: { oldHeading: "Old title", newHeading: "New title" },
    });
  });

  it("uses NFC heading identity for uniqueness", () => {
    expect(detectSafeHeadingRename("## Cafe\u0301\n", "## Résumé\n")).toEqual({
      kind: "safe",
      rename: { oldHeading: "Café", newHeading: "Résumé" },
    });
  });

  it.each([
    [
      "unchanged headings",
      "## A\nbody\n",
      "## A\nnew body\n",
      "unchanged-headings",
    ],
    ["inserted heading", "## A\n", "## A\n### B\n", "structure-changed"],
    ["deleted heading", "## A\n### B\n", "## A\n", "structure-changed"],
    ["changed level", "## A\n", "### B\n", "level-changed"],
    [
      "multiple renames",
      "## A\n## B\n",
      "## C\n## D\n",
      "multiple-heading-changes",
    ],
    ["empty new title", "## A\n", "##\n", "empty-heading"],
    [
      "duplicate old title",
      "## A\n## A\n",
      "## B\n## A\n",
      "duplicate-old-heading",
    ],
    [
      "duplicate new title",
      "## A\n## B\n",
      "## B\n## B\n",
      "duplicate-new-heading",
    ],
  ] as const)("preserves links for %s", (_name, before, after, reason) => {
    expect(detectSafeHeadingRename(before, after)).toEqual({
      kind: "none",
      reason,
    });
  });

  it("ignores heading-shaped text in frontmatter and fences", () => {
    expect(
      detectSafeHeadingRename(
        "---\nname: old\n---\n```md\n## Old\n```\n## Stable\n",
        "---\nname: new\n---\n```md\n## New\n```\n## Stable\n",
      ),
    ).toEqual({ kind: "none", reason: "unchanged-headings" });
  });
});

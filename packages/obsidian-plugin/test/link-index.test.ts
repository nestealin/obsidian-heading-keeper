import { describe, expect, it } from "vitest";
import {
  ReverseHeadingLinkIndex,
  type HeadingLinkRecord,
} from "../src/link-index.js";

function record(
  sourcePath: string,
  targetPath: string,
  fragment: string,
  kind: "link" | "embed" = "link",
): HeadingLinkRecord {
  return { sourcePath, targetPath, fragment, kind };
}

describe("ReverseHeadingLinkIndex", () => {
  it("returns only reverse-index candidates for the renamed fragment", () => {
    const index = new ReverseHeadingLinkIndex();
    index.rebuild([
      record("A.md", "Target.md", "Old"),
      record("B.md", "Other.md", "Old"),
    ]);
    expect(index.candidates("Target.md", ["Old"])).toEqual(["A.md"]);
  });

  it("deduplicates same-file links, embeds, and URL-encoded fragments", () => {
    const index = new ReverseHeadingLinkIndex();
    index.rebuild([
      record("Target.md", "Target.md", "Old title"),
      record("Target.md", "Target.md", "Old title", "embed"),
      record("B.md", "Target.md", "Old title"),
    ]);
    expect(index.candidates("Target.md", ["Old%20title"])).toEqual([
      "B.md",
      "Target.md",
    ]);
  });

  it("updates, renames, and deletes one source deterministically", () => {
    const index = new ReverseHeadingLinkIndex();
    index.rebuild([
      record("z.md", "Target.md", "Old"),
      record("a.md", "Target.md", "Old"),
    ]);
    index.updateSource([record("z.md", "Target.md", "New")]);
    index.renameSource("a.md", "renamed.md");
    expect(index.candidates("Target.md", ["Old", "New"])).toEqual([
      "renamed.md",
      "z.md",
    ]);
    index.deleteSource("renamed.md");
    expect(index.candidates("Target.md", ["Old", "New"])).toEqual(["z.md"]);
  });
});

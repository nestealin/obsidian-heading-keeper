import { describe, expect, it } from "vitest";
import { scanHeadings } from "../src/index.js";

describe("scanHeadings", () => {
  it("scans ATX headings and protects YAML and fences", () => {
    const markdown = [
      "---",
      "title: # not a heading",
      "---",
      "  ## Visible ##  ",
      "```md",
      "### hidden",
      "```",
      "#### Deep",
    ].join("\n");

    expect(
      scanHeadings(markdown).map(({ level, semanticText }) => ({
        level,
        semanticText,
      })),
    ).toEqual([
      { level: 2, semanticText: "Visible" },
      { level: 4, semanticText: "Deep" },
    ]);
  });

  it("preserves ranges and raw syntax needed for a title rewrite", () => {
    const markdown = "  ##  title  ##  \n";

    expect(scanHeadings(markdown)).toEqual([
      {
        level: 2,
        line: 0,
        indent: "  ",
        marker: "##",
        rawText: "title",
        semanticText: "title",
        sourceRange: { from: 0, to: 17 },
        contentRange: { from: 6, to: 11 },
        closingSequence: "  ##  ",
        lineEnding: "\n",
      },
    ]);
  });

  it("handles CRLF input and a final heading without a newline", () => {
    const markdown = "# One\r\n## Two";

    expect(scanHeadings(markdown)).toMatchObject([
      { line: 0, semanticText: "One", sourceRange: { from: 0, to: 5 }, lineEnding: "\r\n" },
      { line: 1, semanticText: "Two", sourceRange: { from: 7, to: 13 }, lineEnding: "" },
    ]);
  });

  it("does not treat indented, H7, or inline hashes as headings", () => {
    const markdown = ["    # code", "####### H7", "text # inline", "# kept"].join("\n");

    expect(scanHeadings(markdown).map((heading) => heading.semanticText)).toEqual([
      "kept",
    ]);
  });

  it("ignores tilde fences until a matching-length closing fence", () => {
    const markdown = ["~~~~md", "# hidden", "~~~", "## still hidden", "~~~~~", "### shown"].join(
      "\n",
    );

    expect(scanHeadings(markdown).map((heading) => heading.semanticText)).toEqual([
      "shown",
    ]);
  });

  it("keeps Unicode text, empty headings, and closing sequences distinct", () => {
    const markdown = ["## 中文 🐙", "###", "#### trailing   ", "##### end #####"].join("\n");

    expect(
      scanHeadings(markdown).map(
        ({ semanticText, rawText, closingSequence }) => ({
          semanticText,
          rawText,
          closingSequence,
        }),
      ),
    ).toEqual([
      { semanticText: "中文 🐙", rawText: "中文 🐙", closingSequence: "" },
      { semanticText: "", rawText: "", closingSequence: "" },
      { semanticText: "trailing", rawText: "trailing   ", closingSequence: "" },
      { semanticText: "end", rawText: "end", closingSequence: " #####" },
    ]);
  });
});

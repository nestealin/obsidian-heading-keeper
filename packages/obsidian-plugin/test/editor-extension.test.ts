import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import {
  createHeadingKeeperExtension,
  planEditorDecorations,
} from "../src/editor-extension.js";

describe("editor virtual decorations", () => {
  it("uses core prefixes for headings while excluding protected Markdown", () => {
    const markdown = [
      "---",
      "title: # hidden",
      "---",
      "## 根节点",
      "```md",
      "### hidden",
      "```",
      "#### Child",
    ].join("\r\n");

    expect(planEditorDecorations(markdown, DEFAULT_STORED_SETTINGS)).toEqual([
      { from: 30, text: "1. " },
      { from: 64, text: "1.1. " },
    ]);
  });

  it("covers H1 through H6 gaps using the supplied core settings", () => {
    const markdown = ["# One", "### Three", "###### Six"].join("\n");
    const settings = {
      ...DEFAULT_STORED_SETTINGS,
      topLevel: 1 as const,
      gapStrategy: "one-fill" as const,
    };

    expect(
      planEditorDecorations(markdown, settings).map((item) => item.text),
    ).toEqual(["1. ", "1.1.1. ", "1.1.1.1.1.1. "]);
  });

  it("creates a decoration-only CodeMirror extension", () => {
    expect(
      createHeadingKeeperExtension(() => DEFAULT_STORED_SETTINGS),
    ).toBeTruthy();
  });
});

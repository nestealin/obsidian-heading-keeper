import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import {
  decorateReadingHeadings,
  planReadingDecorations,
} from "../src/reading-processor.js";
import { planEditorDecorations } from "../src/editor-extension.js";

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | undefined;
  textContent = "";

  constructor(
    readonly tagName: string,
    readonly className = "",
  ) {}

  readonly ownerDocument = {
    createElement: (tagName: string) => new FakeElement(tagName.toUpperCase()),
  };

  get firstChild(): FakeElement | undefined {
    return this.children[0];
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(
    child: FakeElement,
    before: FakeElement | undefined,
  ): FakeElement {
    child.parentElement = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
    return child;
  }

  remove(): void {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) {
      this.parentElement?.children.splice(index, 1);
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const expectedTags = selector.split(", ").map((item) => item.toUpperCase());
    const matchesPrefix = selector === ".heading-numbering-prefix";
    const result: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      for (const child of node.children) {
        if (
          (matchesPrefix && child.className === "heading-numbering-prefix") ||
          (!matchesPrefix && expectedTags.includes(child.tagName))
        ) {
          result.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return result;
  }
}

function readingRoot(levels: number[]): FakeElement {
  const root = new FakeElement("DIV");
  for (const level of levels) {
    root.appendChild(new FakeElement(`H${level}`));
  }
  return root;
}

describe("Reading virtual decorations", () => {
  it("has prefix parity with editor decorations for CRLF and Unicode headings", () => {
    const markdown = [
      "---",
      "title: # hidden",
      "---",
      "## 根",
      "```md",
      "### hidden",
      "```",
      "#### Child",
    ].join("\r\n");
    const editorPrefixes = planEditorDecorations(
      markdown,
      DEFAULT_STORED_SETTINGS,
    );

    expect(
      planReadingDecorations(markdown, DEFAULT_STORED_SETTINGS, [2, 4])
        .prefixes,
    ).toEqual([
      { index: 0, text: "1. " },
      { index: 1, text: "1.1. " },
    ]);
    expect(editorPrefixes.map((prefix) => prefix.text)).toEqual([
      "1. ",
      "1.1. ",
    ]);
  });

  it("inserts accessible owned spans and remains idempotent", () => {
    const root = readingRoot([2, 4]);
    const markdown = "## Root\n#### Child";

    expect(
      decorateReadingHeadings(
        root as unknown as HTMLElement,
        markdown,
        DEFAULT_STORED_SETTINGS,
      ),
    ).toEqual({ diagnostics: [] });
    decorateReadingHeadings(
      root as unknown as HTMLElement,
      markdown,
      DEFAULT_STORED_SETTINGS,
    );

    const prefixes = root.querySelectorAll(".heading-numbering-prefix");
    expect(prefixes).toHaveLength(2);
    expect(prefixes.map((span) => span.textContent)).toEqual(["1. ", "1.1. "]);
    expect(
      prefixes.every((span) => span.attributes.get("aria-hidden") === "true"),
    ).toBe(true);
  });

  it("does not decorate after a visible-heading mismatch", () => {
    const root = readingRoot([2, 3]);

    expect(
      decorateReadingHeadings(
        root as unknown as HTMLElement,
        "## Root\n#### Child",
        DEFAULT_STORED_SETTINGS,
      ),
    ).toEqual({
      diagnostics: [
        {
          code: "reading-heading-mismatch",
          index: 1,
          message: "Visible heading level does not match source heading level.",
        },
      ],
    });
    expect(root.querySelectorAll(".heading-numbering-prefix")).toHaveLength(1);
  });
});

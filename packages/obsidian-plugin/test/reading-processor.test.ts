import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import {
  clearHeadingKeeperPrefixes,
  decorateReadingHeadings,
  planReadingDecorations,
  registerReadingRoot,
} from "../src/reading-processor.js";
import { planEditorDecorations } from "../src/editor-extension.js";

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | undefined;
  textContent = "";

  className = "";

  constructor(readonly tagName: string) {}

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
    const matchesPrefix = selector === ".heading-keeper-prefix";
    const result: FakeElement[] = [];
    const visit = (node: FakeElement): void => {
      for (const child of node.children) {
        if (
          (matchesPrefix && child.className === "heading-keeper-prefix") ||
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

const firstSection = { lineEnd: 0, lineStart: 0 };

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
      planReadingDecorations(markdown, DEFAULT_STORED_SETTINGS, [2, 4], {
        lineEnd: 7,
        lineStart: 0,
      }).prefixes,
    ).toEqual([
      { index: 0, text: "1. " },
      { index: 1, text: "1.1. " },
    ]);
    expect(editorPrefixes.map((prefix) => prefix.text)).toEqual([
      "1. ",
      "1.1. ",
    ]);
  });

  it("maps each section to a filtered full-document plan", () => {
    const markdown = "## A\n## B";

    expect(
      planReadingDecorations(markdown, DEFAULT_STORED_SETTINGS, [2], {
        lineEnd: 0,
        lineStart: 0,
      }),
    ).toEqual({ diagnostics: [], prefixes: [{ index: 0, text: "1. " }] });
    expect(
      planReadingDecorations(markdown, DEFAULT_STORED_SETTINGS, [2], {
        lineEnd: 1,
        lineStart: 1,
      }),
    ).toEqual({ diagnostics: [], prefixes: [{ index: 0, text: "2. " }] });
  });

  it("preserves hierarchy for a non-first section with a different heading level", () => {
    expect(
      planReadingDecorations("## A\n#### B", DEFAULT_STORED_SETTINGS, [4], {
        lineEnd: 1,
        lineStart: 1,
      }),
    ).toEqual({ diagnostics: [], prefixes: [{ index: 0, text: "1.1. " }] });
  });

  it("rejects null and out-of-range section metadata without decorations", () => {
    expect(
      planReadingDecorations("## A", DEFAULT_STORED_SETTINGS, [2], null),
    ).toEqual({
      diagnostics: [
        {
          code: "reading-section-info-invalid",
          index: 0,
          message: "Reading section information is unavailable or invalid.",
        },
      ],
      prefixes: [],
    });
    expect(
      planReadingDecorations(
        "## A",
        DEFAULT_STORED_SETTINGS,
        [2],
        {} as unknown as { lineEnd: number; lineStart: number },
      ),
    ).toEqual({
      diagnostics: [
        {
          code: "reading-section-info-invalid",
          index: 0,
          message: "Reading section information is unavailable or invalid.",
        },
      ],
      prefixes: [],
    });
    expect(
      planReadingDecorations("## A", DEFAULT_STORED_SETTINGS, [2], {
        lineEnd: 1,
        lineStart: 1,
      }),
    ).toEqual({
      diagnostics: [
        {
          code: "reading-section-range-invalid",
          index: 1,
          message: "Reading section range is outside the source document.",
        },
      ],
      prefixes: [],
    });
  });

  it("inserts accessible owned spans and remains idempotent", () => {
    const root = readingRoot([2, 4]);
    const markdown = "## Root\n#### Child";

    expect(
      decorateReadingHeadings(
        root as unknown as HTMLElement,
        markdown,
        DEFAULT_STORED_SETTINGS,
        { lineEnd: 1, lineStart: 0 },
      ),
    ).toEqual({ diagnostics: [] });
    decorateReadingHeadings(
      root as unknown as HTMLElement,
      markdown,
      DEFAULT_STORED_SETTINGS,
      { lineEnd: 1, lineStart: 0 },
    );

    const prefixes = root.querySelectorAll(".heading-keeper-prefix");
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
        { lineEnd: 1, lineStart: 0 },
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
    expect(root.querySelectorAll(".heading-keeper-prefix")).toHaveLength(0);
  });

  it("keeps user spans sharing the public class while replacing only owned spans", () => {
    const root = readingRoot([2]);
    const heading = root.children[0];
    const userPrefix = new FakeElement("SPAN");
    userPrefix.className = "heading-keeper-prefix";
    heading?.appendChild(userPrefix);

    decorateReadingHeadings(
      root as unknown as HTMLElement,
      "## Root",
      DEFAULT_STORED_SETTINGS,
      firstSection,
    );
    clearHeadingKeeperPrefixes(root as unknown as HTMLElement);

    expect(heading?.children).toEqual([userPrefix]);
  });

  it("keeps parent and nested root decorations isolated in either render order", () => {
    const renderInOrder = (childFirst: boolean) => {
      const parent = readingRoot([2]);
      const child = readingRoot([2]);
      parent.appendChild(child);
      const renderParent = () =>
        decorateReadingHeadings(
          parent as unknown as HTMLElement,
          "## Parent\n## Child",
          DEFAULT_STORED_SETTINGS,
          { lineEnd: 1, lineStart: 0 },
        );
      const renderChild = () =>
        decorateReadingHeadings(
          child as unknown as HTMLElement,
          "## Parent\n## Child",
          DEFAULT_STORED_SETTINGS,
          { lineEnd: 1, lineStart: 1 },
        );

      if (childFirst) {
        renderChild();
        renderParent();
      } else {
        renderParent();
        renderChild();
      }
      return { child, parent };
    };

    for (const childFirst of [false, true]) {
      const { child, parent } = renderInOrder(childFirst);
      expect(
        parent.children[0]?.children.map((node) => node.textContent),
      ).toEqual(["1. "]);
      expect(
        child.children[0]?.children.map((node) => node.textContent),
      ).toEqual(["2. "]);
    }
  });

  it("keeps cross-document embedded root ranges in their own source identity", () => {
    const renderInOrder = (childFirst: boolean) => {
      const parent = readingRoot([2]);
      const child = readingRoot([2]);
      parent.appendChild(child);
      const parentSection = { lineEnd: 1, lineStart: 0 };
      const childSection = { lineEnd: 0, lineStart: 0 };
      registerReadingRoot(
        parent as unknown as HTMLElement,
        parentSection,
        "Parent.md",
      );
      registerReadingRoot(
        child as unknown as HTMLElement,
        childSection,
        "Child.md",
      );
      const renderParent = () =>
        decorateReadingHeadings(
          parent as unknown as HTMLElement,
          "## Parent\n![[Child]]",
          DEFAULT_STORED_SETTINGS,
          parentSection,
          "Parent.md",
        );
      const renderChild = () =>
        decorateReadingHeadings(
          child as unknown as HTMLElement,
          "## Child",
          DEFAULT_STORED_SETTINGS,
          childSection,
          "Child.md",
        );

      if (childFirst) {
        renderChild();
        renderParent();
      } else {
        renderParent();
        renderChild();
      }
      return { child, parent };
    };

    for (const childFirst of [false, true]) {
      const { child, parent } = renderInOrder(childFirst);
      expect(
        parent.children[0]?.children.map((node) => node.textContent),
      ).toEqual(["1. "]);
      expect(
        child.children[0]?.children.map((node) => node.textContent),
      ).toEqual(["1. "]);
    }
  });
});

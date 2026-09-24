import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import {
  clearHeadingKeeperPrefixes,
  decorateReadingHeadings,
  planReadingDecorations,
  registerReadingRoot,
  splitReadingPrefix,
} from "../src/reading-processor.js";
import { planEditorDecorations } from "../src/editor-extension.js";

class FakeText {
  readonly nodeType = 3;
  parentElement: FakeElement | undefined;

  constructor(public data: string) {}
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly childNodes: Array<FakeElement | FakeText> = [];
  parentElement: FakeElement | undefined;
  textContent = "";
  throwOnInsert = false;

  className = "";

  constructor(readonly tagName: string) {}

  readonly ownerDocument = {
    createElement: (tagName: string) => new FakeElement(tagName.toUpperCase()),
    createTreeWalker: (root: FakeElement) => ({
      nextNode: (): FakeText | null => {
        const visit = (element: FakeElement): FakeText | null => {
          for (const child of element.childNodes) {
            if (child instanceof FakeText) return child;
            const nested = visit(child);
            if (nested) return nested;
          }
          return null;
        };
        return visit(root);
      },
    }),
  };

  get firstChild(): FakeElement | FakeText | undefined {
    return this.childNodes[0];
  }

  appendText(data: string): FakeText {
    const text = new FakeText(data);
    text.parentElement = this;
    this.childNodes.push(text);
    return text;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }

  insertBefore(
    child: FakeElement,
    before: FakeElement | FakeText | undefined,
  ): FakeElement {
    if (this.throwOnInsert) throw new Error("render-insert-failed");
    child.parentElement = this;
    const nodeIndex = before ? this.childNodes.indexOf(before) : -1;
    if (nodeIndex < 0) {
      this.childNodes.push(child);
    } else {
      this.childNodes.splice(nodeIndex, 0, child);
    }
    const elementIndex =
      before instanceof FakeElement ? this.children.indexOf(before) : -1;
    if (elementIndex < 0) {
      this.children.push(child);
    } else {
      this.children.splice(elementIndex, 0, child);
    }
    return child;
  }

  remove(): void {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) {
      this.parentElement?.children.splice(index, 1);
    }
    const nodeIndex = this.parentElement?.childNodes.indexOf(this) ?? -1;
    if (nodeIndex >= 0) {
      this.parentElement?.childNodes.splice(nodeIndex, 1);
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
  it("splits only the managed source prefix from rendered heading text", () => {
    expect(splitReadingPrefix("9. Old title", "9. ")).toEqual({
      hidden: "9. ",
      visible: "Old title",
    });
    expect(splitReadingPrefix("9. Old title", "")).toBeNull();
    expect(splitReadingPrefix("9. Old title", "8. ")).toBeNull();
    expect(
      splitReadingPrefix("9. Old title", "9. Old title and more"),
    ).toBeNull();
  });

  it("never drops bytes while splitting arbitrary rendered text", () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (text, prefix) => {
        const result = splitReadingPrefix(text, prefix);
        if (text.startsWith(prefix)) {
          expect(result?.hidden + result?.visible).toBe(text);
        } else {
          expect(result).toBeNull();
        }
      }),
      { numRuns: 1000 },
    );
  });

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

  it("plans replacement of stale visible prefixes without removing semantic title text", () => {
    expect(
      planReadingDecorations(
        "## 9. Old title\n## 2024. Roadmap",
        DEFAULT_STORED_SETTINGS,
        [2, 2],
        { lineEnd: 1, lineStart: 0 },
      ).prefixes,
    ).toEqual([
      { index: 0, replaceText: "9. ", text: "1. " },
      { index: 1, text: "2. " },
    ]);
  });

  it("does not remove foreign inline text before a managed prefix", () => {
    const root = readingRoot([2]);
    const heading = root.children[0]!;
    const foreign = heading.appendChild(new FakeElement("SPAN"));
    const foreignText = foreign.appendText("重要标签");
    const titleText = heading.appendText("9. 保留标题");

    decorateReadingHeadings(
      root as unknown as HTMLElement,
      "## 9. 保留标题",
      DEFAULT_STORED_SETTINGS,
      firstSection,
    );

    expect(foreignText.data).toBe("重要标签");
    expect(titleText.data).toBe("保留标题");
    expect(root.querySelectorAll(".heading-keeper-prefix")).toHaveLength(1);
    clearHeadingKeeperPrefixes(root as unknown as HTMLElement);
    expect(titleText.data).toBe("9. 保留标题");
    expect(foreignText.data).toBe("重要标签");
  });

  it("does not hide unrelated text when rendered source prefix is missing", () => {
    const root = readingRoot([2]);
    const titleText = root.children[0]!.appendText("保留标题");

    decorateReadingHeadings(
      root as unknown as HTMLElement,
      "## 9. 保留标题",
      DEFAULT_STORED_SETTINGS,
      firstSection,
    );

    expect(titleText.data).toBe("保留标题");
    expect(root.querySelectorAll(".heading-keeper-prefix")).toHaveLength(0);
  });

  it("does not hide source text when inserting the visual prefix fails", () => {
    const root = readingRoot([2]);
    const heading = root.children[0]!;
    const titleText = heading.appendText("9. 保留标题");
    heading.throwOnInsert = true;

    expect(() =>
      decorateReadingHeadings(
        root as unknown as HTMLElement,
        "## 9. 保留标题",
        DEFAULT_STORED_SETTINGS,
        firstSection,
      ),
    ).toThrow("render-insert-failed");
    expect(titleText.data).toBe("9. 保留标题");
    expect(root.querySelectorAll(".heading-keeper-prefix")).toHaveLength(0);
  });

  it("clears virtual prefixes and does not decorate in persisted mode", () => {
    const root = readingRoot([2]);
    decorateReadingHeadings(
      root as unknown as HTMLElement,
      "## Root",
      DEFAULT_STORED_SETTINGS,
      firstSection,
    );
    expect(root.querySelectorAll(".heading-keeper-prefix")).toHaveLength(1);

    decorateReadingHeadings(
      root as unknown as HTMLElement,
      "## Root",
      { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      firstSection,
    );
    expect(root.querySelectorAll(".heading-keeper-prefix")).toHaveLength(0);
  });

  it("preserves hierarchy for a non-first section with a different heading level", () => {
    expect(
      planReadingDecorations("## A\n#### B", DEFAULT_STORED_SETTINGS, [4], {
        lineEnd: 1,
        lineStart: 1,
      }),
    ).toEqual({ diagnostics: [], prefixes: [{ index: 0, text: "1.1. " }] });
  });

  it("does not overlay a noncanonical numeric heading in Reading virtual mode", () => {
    const markdown =
      "## 根因分析\n### 1. 初步假设\n### 2. 验证过程\n#### 2.1 锁定运行态目标\n";
    expect(
      planReadingDecorations(
        markdown,
        { ...DEFAULT_STORED_SETTINGS, topLevel: 3, bottomLevel: 5 },
        [2, 3, 3, 4],
        { lineStart: 0, lineEnd: 3 },
      ),
    ).toEqual({ diagnostics: [], prefixes: [] });
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

import { StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  buildNumberingPlan,
  scanHeadings,
  type NumberingSettings,
} from "@heading-numbering/core";

export interface EditorPrefix {
  from: number;
  text: string;
}

export const refreshHeadingNumbering = StateEffect.define<void>();

const activeEditorViews = new Set<EditorView>();

export function planEditorDecorations(
  markdown: string,
  settings: NumberingSettings,
): EditorPrefix[] {
  const plan = buildNumberingPlan(scanHeadings(markdown), settings);
  return plan.entries.flatMap((entry) => {
    if (entry.action !== "insert" || entry.displayPrefix === "") {
      return [];
    }
    return [
      {
        from: entry.heading.contentRange.from,
        text: `${entry.displayPrefix}${plan.format.titleSeparator}`,
      },
    ];
  });
}

class PrefixWidget extends WidgetType {
  constructor(private readonly text: string) {
    super();
  }

  eq(other: PrefixWidget): boolean {
    return this.text === other.text;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "heading-numbering-prefix";
    element.setAttribute("aria-hidden", "true");
    element.textContent = this.text;
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function createDecorations(
  view: EditorView,
  getSettings: () => NumberingSettings,
): DecorationSet {
  const prefixes = planEditorDecorations(
    view.state.doc.toString(),
    getSettings(),
  );
  return Decoration.set(
    prefixes.map((prefix) =>
      Decoration.widget({
        widget: new PrefixWidget(prefix.text),
        side: -1,
      }).range(prefix.from),
    ),
    true,
  );
}

function shouldRefresh(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.viewportChanged ||
    update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(refreshHeadingNumbering)),
    )
  );
}

export function createHeadingNumberingExtension(
  getSettings: () => NumberingSettings,
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(readonly view: EditorView) {
        activeEditorViews.add(view);
        this.decorations = createDecorations(view, getSettings);
      }

      update(update: ViewUpdate): void {
        if (shouldRefresh(update)) {
          this.decorations = createDecorations(update.view, getSettings);
        }
      }

      destroy(): void {
        activeEditorViews.delete(this.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

export function refreshHeadingNumberingExtensions(): void {
  for (const view of activeEditorViews) {
    view.dispatch({ effects: refreshHeadingNumbering.of(undefined) });
  }
}

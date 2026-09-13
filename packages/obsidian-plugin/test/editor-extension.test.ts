import {
  EditorState,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import {
  createHeadingKeeperExtension,
  planEditorDecorations,
} from "../src/editor-extension.js";

function editorExtensionHarness(markdown: string) {
  let state = EditorState.create({ doc: markdown });
  let composing = false;
  let compositionStarted = false;
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  const actions: string[] = [];
  const info = {
    file: { path: "Target.md" },
    save: async () => actions.push("save"),
  };
  const ownerWindow = {
    setTimeout: (callback: () => void) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
  };
  let pluginRef:
    | {
        update: (update: ViewUpdate) => void;
        destroy: () => void;
      }
    | undefined;
  const view = {
    get state() {
      return {
        doc: state.doc,
        selection: state.selection,
        field: () => info,
      };
    },
    get composing() {
      return composing;
    },
    get compositionStarted() {
      return compositionStarted;
    },
    hasFocus: true,
    dom: { ownerDocument: { defaultView: ownerWindow } },
    dispatch: (spec: TransactionSpec) => {
      const transaction = state.update(spec);
      state = transaction.state;
      pluginRef?.update({
        view,
        state,
        transactions: [transaction],
        docChanged: transaction.docChanged,
        focusChanged: false,
        selectionSet: transaction.selection !== undefined,
        viewportChanged: false,
      } as unknown as ViewUpdate);
    },
  } as unknown as EditorView;
  const extension = createHeadingKeeperExtension(
    () => ({ ...DEFAULT_STORED_SETTINGS, mode: "persisted" }),
    {
      stage: async () => {
        actions.push("stage");
        return "intent-1";
      },
      cancel: async () => actions.push("cancel"),
    },
  ) as unknown as {
    create: (view: EditorView) => {
      update: (update: ViewUpdate) => void;
      destroy: () => void;
    };
  };
  const plugin = extension.create(view);
  pluginRef = plugin;

  return {
    actions,
    plugin,
    pendingTimers: () => timers.size,
    setComposition: (active: boolean) => {
      composing = active;
      compositionStarted = active;
    },
    update: (next: EditorState, transactions: readonly Transaction[]) => {
      state = next;
      plugin.update({
        view,
        state: next,
        transactions,
        docChanged: transactions.some((transaction) => transaction.docChanged),
        focusChanged: false,
        selectionSet: transactions.some(
          (transaction) => transaction.selection !== undefined,
        ),
        viewportChanged: false,
      } as unknown as ViewUpdate);
    },
    runTimer: async () => {
      const entry = timers.entries().next().value as
        | [number, () => void]
        | undefined;
      if (!entry) throw new Error("timer-missing");
      timers.delete(entry[0]);
      entry[1]();
      await Promise.resolve();
      await Promise.resolve();
    },
    state: () => state,
  };
}

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

  it("visually replaces stale managed numbering and prefixes semantic titles", () => {
    expect(
      planEditorDecorations(
        "## 9. Old title\n## 2024. Roadmap\n",
        DEFAULT_STORED_SETTINGS,
      ),
    ).toEqual([
      { from: 3, to: 6, text: "1. " },
      { from: 19, text: "2. " },
    ]);
  });

  it("creates a decoration-only CodeMirror extension", () => {
    expect(
      createHeadingKeeperExtension(() => DEFAULT_STORED_SETTINGS),
    ).toBeTruthy();
  });

  it("renders no provisional widgets in persisted mode", () => {
    expect(
      planEditorDecorations("## Alpha\n### Child\n", {
        ...DEFAULT_STORED_SETTINGS,
        mode: "persisted",
      }),
    ).toEqual([]);
  });

  it("suppresses virtual widgets on the active editing line", () => {
    expect(
      planEditorDecorations("## Alpha\n### Child\n", DEFAULT_STORED_SETTINGS, {
        from: 0,
        to: 8,
      }),
    ).toEqual([{ from: 13, text: "1.1. " }]);
  });

  it("retries maintenance when CodeMirror still reports composition after the timer", async () => {
    const harness = editorExtensionHarness("### 笔记内恢复\n");
    harness.setComposition(true);

    await harness.runTimer();

    expect(harness.actions).toEqual([]);
    expect(harness.pendingTimers()).toBe(1);
    harness.plugin.destroy();
  });

  it("does not immediately reapply numbering after the user undoes it", async () => {
    const harness = editorExtensionHarness("### 1. 笔记内恢复\n");
    await harness.runTimer();
    expect(harness.pendingTimers()).toBe(0);
    const initial = harness.state();
    const undo = initial.update({
      changes: { from: 4, to: 7, insert: "" },
      annotations: Transaction.userEvent.of("undo"),
    });

    harness.update(undo.state, [undo]);

    expect(harness.pendingTimers()).toBe(0);
    harness.plugin.destroy();
  });

  it("stops polling while two editors own a path and wakes the survivor", async () => {
    const first = editorExtensionHarness("### 笔记内恢复\n");
    const second = editorExtensionHarness("### 笔记内恢复\n");

    try {
      await first.runTimer();
      await second.runTimer();

      expect(first.pendingTimers()).toBe(0);
      expect(second.pendingTimers()).toBe(0);

      second.plugin.destroy();

      expect(first.pendingTimers()).toBe(1);
    } finally {
      first.plugin.destroy();
      second.plugin.destroy();
    }
  });
});

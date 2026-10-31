import {
  EditorState,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { Decoration, type EditorView, type ViewUpdate } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import {
  createHeadingKeeperExtension,
  openEditorFileSurface,
  planEditorDecorations,
  refreshHeadingKeeperExtensions,
  refreshHeadingKeeperEditorModes,
} from "../src/editor-extension.js";

function editorExtensionHarness(
  markdown: string,
  initialMode = "source",
  options: {
    nested?: boolean;
    noEditor?: boolean;
    noFile?: boolean;
    virtual?: boolean;
  } = {},
) {
  let mode = initialMode;
  let state = EditorState.create({ doc: markdown });
  let composing = false;
  let compositionStarted = false;
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  const actions: string[] = [];
  let dispatches = 0;
  const info = {
    file: options.noFile ? undefined : { path: "Target.md" },
    editor: options.noEditor
      ? undefined
      : { getValue: () => state.doc.toString() },
    getMode: () => mode,
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
        decorations: typeof Decoration.none;
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
    dom: {
      ownerDocument: { defaultView: ownerWindow },
      parentElement: { closest: () => (options.nested ? {} : null) },
    },
    dispatch: (spec: TransactionSpec) => {
      dispatches += 1;
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
    () => ({
      ...DEFAULT_STORED_SETTINGS,
      topLevel: 3,
      bottomLevel: 5,
      mode: options.virtual ? "virtual" : "persisted",
    }),
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
    dispatchCount: () => dispatches,
    setPath: (path: string) => {
      if (!info.file) throw new Error("file-missing");
      info.file.path = path;
      plugin.update({
        view,
        state,
        transactions: [],
        docChanged: false,
        focusChanged: false,
        selectionSet: false,
        viewportChanged: false,
      } as unknown as ViewUpdate);
    },
    setMode: (next: string) => {
      mode = next;
    },
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
      for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    },
    state: () => state,
  };
}

describe("editor virtual decorations", () => {
  it("does not register or refresh a nested table cell as a file owner", async () => {
    const outer = editorExtensionHarness("### Whole note\n");
    const nested = editorExtensionHarness("cell text", "source", {
      nested: true,
    });
    try {
      expect(nested.plugin.decorations).toBe(Decoration.none);
      expect(nested.pendingTimers()).toBe(0);
      expect(openEditorFileSurface.read("Target.md")).toEqual({
        kind: "ready",
        text: outer.state().doc.toString(),
      });
      const edit = nested
        .state()
        .update({ changes: { from: 0, to: 4, insert: "CELL" } });
      nested.update(edit.state, [edit]);
      expect(nested.pendingTimers()).toBe(0);
      expect(nested.actions).toEqual([]);
      const outerDispatches = outer.dispatchCount();
      nested.plugin.destroy();
      expect(outer.dispatchCount()).toBe(outerDispatches);
      expect(openEditorFileSurface.read("Target.md").kind).toBe("ready");
    } finally {
      outer.plugin.destroy();
      nested.plugin.destroy();
    }
  });

  it("fails closed for a view without an editor owner", () => {
    const unknown = editorExtensionHarness("### Unknown\n", "source", {
      noFile: true,
    });
    try {
      expect(unknown.plugin.decorations).toBe(Decoration.none);
      expect(unknown.pendingTimers()).toBe(0);
      expect(openEditorFileSurface.read("Target.md")).toEqual({
        kind: "closed",
      });
    } finally {
      unknown.plugin.destroy();
    }
  });

  it("keeps a top-level view when optional editorInfo.editor is absent", () => {
    const owner = editorExtensionHarness("### Owner\n", "source", {
      noEditor: true,
    });
    try {
      expect(openEditorFileSurface.read("Target.md")).toEqual({
        kind: "ready",
        text: "### Owner\n",
      });
      expect(owner.pendingTimers()).toBe(1);
    } finally {
      owner.plugin.destroy();
    }
  });

  it("keeps virtual decorations without optional editorInfo.editor", () => {
    const owner = editorExtensionHarness("### Owner\n#### Child\n", "source", {
      noEditor: true,
      virtual: true,
    });
    try {
      expect(owner.plugin.decorations.size).toBe(1);
      expect(owner.pendingTimers()).toBe(0);
    } finally {
      owner.plugin.destroy();
    }
  });

  it("does not send global refresh transactions to a nested cell", () => {
    const outer = editorExtensionHarness("### Whole note\n");
    const nested = editorExtensionHarness("cell text", "source", {
      nested: true,
    });
    try {
      refreshHeadingKeeperExtensions();
      expect(outer.dispatchCount()).toBe(1);
      expect(nested.dispatchCount()).toBe(0);
    } finally {
      outer.plugin.destroy();
      nested.plugin.destroy();
    }
  });

  it("wakes a surviving full-note editor without dispatch and only once", async () => {
    const first = editorExtensionHarness("### Waiting\n");
    const second = editorExtensionHarness("### Waiting\n");
    try {
      await first.runTimer();
      await second.runTimer();
      expect(openEditorFileSurface.read("Target.md").kind).toBe("busy");
      const before = first.dispatchCount();
      second.plugin.destroy();
      expect(first.pendingTimers()).toBe(1);
      expect(first.dispatchCount()).toBe(before);
      second.plugin.destroy();
      expect(first.pendingTimers()).toBe(1);
      expect(first.dispatchCount()).toBe(before);
      await first.runTimer();
      expect(first.state().doc.toString()).toBe("### 1. Waiting\n");
      expect(first.actions).toEqual(["stage"]);
      expect(first.dispatchCount()).toBe(before + 1);
      expect(first.pendingTimers()).toBe(0);
      expect(openEditorFileSurface.read("Target.md").kind).toBe("ready");
    } finally {
      first.plugin.destroy();
      second.plugin.destroy();
    }
  });

  it("wakes the old-path survivor when another owner moves", async () => {
    const first = editorExtensionHarness("### Wait\n");
    const second = editorExtensionHarness("### Wait\n");
    try {
      await first.runTimer();
      await second.runTimer();
      const before = first.dispatchCount();
      second.setPath("Moved.md");
      expect(first.pendingTimers()).toBe(1);
      expect(first.dispatchCount()).toBe(before);
      expect(openEditorFileSurface.read("Moved.md").kind).toBe("ready");
      await first.runTimer();
      expect(first.state().doc.toString()).toBe("### 1. Wait\n");
      expect(first.actions).toEqual(["stage"]);
      expect(openEditorFileSurface.read("Target.md").kind).toBe("ready");
    } finally {
      first.plugin.destroy();
      second.plugin.destroy();
    }
  });

  it("moves an owner between paths without leaving an old-path registration", () => {
    const source = editorExtensionHarness("### Move\n");
    try {
      expect(openEditorFileSurface.read("Target.md").kind).toBe("ready");
      source.setPath("Moved.md");
      expect(openEditorFileSurface.read("Target.md").kind).toBe("closed");
      expect(openEditorFileSurface.read("Moved.md").kind).toBe("ready");
      source.setPath("Moved.md");
      source.plugin.destroy();
      source.plugin.destroy();
      expect(openEditorFileSurface.read("Moved.md").kind).toBe("closed");
    } finally {
      source.plugin.destroy();
    }
  });

  it("updates a heading link through the source editor with a reading view open", async () => {
    const before = "[[Target#Old]]\n";
    const after = "[[Target#New]]\n";
    const source = editorExtensionHarness(before);
    const preview = editorExtensionHarness(before, "preview");
    try {
      const result = await openEditorFileSurface.compareAndUpdate(
        "Target.md",
        before,
        after,
        [
          {
            range: { from: 9, to: 12 },
            expectedText: "Old",
            replacementText: "New",
          },
        ],
        async (text) => text,
      );
      expect(result.kind).toBe("updated");
      expect(source.state().doc.toString()).toBe(after);
      expect(preview.state().doc.toString()).toBe(before);
    } finally {
      source.plugin.destroy();
      preview.plugin.destroy();
    }
  });

  it("numbers the source editor while a reading view retains its CodeMirror instance", async () => {
    const source = editorExtensionHarness(
      "### Parent\n#### Group\n##### Child\n",
    );
    const preview = editorExtensionHarness(
      "### Parent\n#### Group\n##### Child\n",
      "preview",
    );
    try {
      await source.runTimer();
      await preview.runTimer();
      expect(source.state().doc.toString()).toBe(
        "### 1. Parent\n#### 1.1. Group\n##### 1.1.1. Child\n",
      );
      expect(preview.state().doc.toString()).toBe(
        "### Parent\n#### Group\n##### Child\n",
      );
      expect(openEditorFileSurface.read("Target.md")).toEqual({
        kind: "ready",
        text: source.state().doc.toString(),
      });
    } finally {
      source.plugin.destroy();
      preview.plugin.destroy();
    }
  });

  it("does not number a retained reading-mode editor", async () => {
    const preview = editorExtensionHarness("### Parent\n", "preview");
    try {
      await preview.runTimer();
      expect(preview.state().doc.toString()).toBe("### Parent\n");
      expect(preview.actions).toEqual([]);
    } finally {
      preview.plugin.destroy();
    }
  });

  it("resumes after a second editor switches to reading mode and blocks when it switches back", async () => {
    const first = editorExtensionHarness("### Parent\n");
    const second = editorExtensionHarness("### Parent\n");
    try {
      await first.runTimer();
      await second.runTimer();
      expect(first.state().doc.toString()).toBe("### Parent\n");
      expect(openEditorFileSurface.read("Target.md").kind).toBe("busy");
      second.setMode("preview");
      refreshHeadingKeeperEditorModes();
      await first.runTimer();
      expect(first.state().doc.toString()).toBe("### 1. Parent\n");
      second.setMode("source");
      expect(openEditorFileSurface.read("Target.md").kind).toBe("busy");
    } finally {
      first.plugin.destroy();
      second.plugin.destroy();
    }
  });

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

  it("does not overlay a noncanonical numeric heading in virtual mode", () => {
    expect(
      planEditorDecorations(
        "## 根因分析\n### 1. 初步假设\n### 2. 验证过程\n#### 2.1 锁定运行态目标\n",
        { ...DEFAULT_STORED_SETTINGS, topLevel: 3, bottomLevel: 5 },
      ),
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
    refreshHeadingKeeperEditorModes();

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
      await first.runTimer();
      expect(first.state().doc.toString()).toBe("### 1. 笔记内恢复\n");
      expect(first.actions).toEqual(["stage"]);
    } finally {
      first.plugin.destroy();
      second.plugin.destroy();
    }
  });
});

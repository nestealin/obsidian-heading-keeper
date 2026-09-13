import {
  Annotation,
  StateEffect,
  type Extension,
  type StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { editorInfoField, type MarkdownFileInfo } from "obsidian";
import {
  analyzeHeadingPrefix,
  buildNumberingPlan,
  scanHeadings,
  type NumberingSettings,
} from "@heading-keeper/core";
import {
  runEditorMaintenanceOnce,
  type EditorMaintenanceSnapshot,
  type EditorMaterialization,
} from "./editor-maintenance.js";
import { applyCheckedEdits } from "./persistence/edits.js";
import type { PlannedTextEdit } from "./persistence/types.js";
import type { StoredSettings } from "./settings.js";
import type { OpenEditorFileSurface } from "./obsidian-adapters.js";

export interface EditorPrefix {
  from: number;
  text: string;
  to?: number;
}

export const refreshHeadingKeeper = StateEffect.define<void>();
const headingKeeperTransaction = Annotation.define<boolean>();

const activeEditorViews = new Set<EditorView>();
const editorViewsByPath = new Map<string, Set<EditorView>>();
const compatibleEditorInfoField =
  editorInfoField as unknown as StateField<MarkdownFileInfo>;

export interface EditorMaintenanceHooks {
  readonly stage: (materialization: EditorMaterialization) => Promise<string>;
  readonly cancel: (intentId: string) => Promise<unknown>;
}

export const openEditorFileSurface: OpenEditorFileSurface = {
  read: (path) => {
    const editor = singleEditor(path);
    if (editor.kind !== "ready") return editor;
    return { kind: "ready", text: editor.view.state.doc.toString() };
  },
  compareAndUpdate: async (
    path,
    expectedHash,
    resultingHash,
    edits,
    hashText,
  ) => {
    const editor = singleEditor(path);
    if (editor.kind !== "ready") return editor;
    const beforeText = editor.view.state.doc.toString();
    const currentHash = await hashText(beforeText);
    if (currentHash === resultingHash) {
      await editor.save();
      return { kind: "already-applied" };
    }
    if (currentHash !== expectedHash) return { kind: "stale" };
    const updated = applyCheckedEdits(beforeText, edits);
    if ((await hashText(updated)) !== resultingHash) {
      throw new Error("result-hash-mismatch");
    }
    const current = singleEditor(path);
    if (current.kind !== "ready") return current;
    if (
      current.view !== editor.view ||
      current.view.state.doc.toString() !== beforeText
    ) {
      return { kind: "stale" };
    }
    dispatchEditorEdits(current.view, edits);
    await current.save();
    return { kind: "updated" };
  },
};

export function planEditorDecorations(
  markdown: string,
  settings: NumberingSettings,
  suppressedRange?: { readonly from: number; readonly to: number },
): EditorPrefix[] {
  if ("mode" in settings && settings.mode === "persisted") return [];
  const plan = buildNumberingPlan(scanHeadings(markdown), settings);
  return plan.entries.flatMap((entry) => {
    if (
      (entry.action !== "insert" && entry.action !== "replace") ||
      entry.displayPrefix === ""
    ) {
      return [];
    }
    const from = entry.heading.contentRange.from;
    if (
      suppressedRange &&
      from >= suppressedRange.from &&
      from <= suppressedRange.to
    ) {
      return [];
    }
    const analysis = analyzeHeadingPrefix(
      entry.heading,
      entry.displayPrefix,
      plan.format,
    );
    return [
      {
        from: analysis.managedRange?.from ?? entry.heading.contentRange.from,
        text: `${entry.displayPrefix}${plan.format.titleSeparator}`,
        ...(analysis.managedRange ? { to: analysis.managedRange.to } : {}),
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

  toDOM(view: EditorView): HTMLElement {
    const element = view.dom.ownerDocument.createElement("span");
    element.className = "heading-keeper-prefix";
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
    editingLine(view),
  );
  return Decoration.set(
    prefixes.map((prefix) => {
      const widget = new PrefixWidget(prefix.text);
      return prefix.to === undefined
        ? Decoration.widget({ widget, side: -1 }).range(prefix.from)
        : Decoration.replace({ widget }).range(prefix.from, prefix.to);
    }),
    true,
  );
}

function shouldRefresh(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.focusChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    update.transactions.some((transaction) =>
      transaction.effects.some((effect) => effect.is(refreshHeadingKeeper)),
    )
  );
}

export function createHeadingKeeperExtension(
  getSettings: () => StoredSettings,
  maintenance?: EditorMaintenanceHooks,
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private disposed = false;
      private generation = 0;
      private path: string | null = null;
      private timer: number | null = null;
      private wasComposing: boolean;

      constructor(readonly view: EditorView) {
        activeEditorViews.add(view);
        this.path = editorPath(view);
        registerEditorPath(view, this.path);
        this.wasComposing = isComposing(view);
        this.decorations = createDecorations(view, getSettings);
        if (getSettings().mode === "persisted") this.schedule();
      }

      update(update: ViewUpdate): void {
        const previousComposing = this.wasComposing;
        this.wasComposing = isComposing(update.view);
        const nextPath = editorPath(update.view);
        if (nextPath !== this.path) {
          unregisterEditorPath(update.view, this.path);
          this.path = nextPath;
          registerEditorPath(update.view, this.path);
          this.generation += 1;
        }
        if (update.docChanged) this.generation += 1;
        if (shouldRefresh(update)) {
          this.decorations = createDecorations(update.view, getSettings);
        }
        const ownTransaction = update.transactions.some(
          (transaction) =>
            transaction.annotation(headingKeeperTransaction) === true,
        );
        const settingsRefresh = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(refreshHeadingKeeper)),
        );
        const historyNavigation = update.transactions.some(
          (transaction) =>
            transaction.isUserEvent("undo") || transaction.isUserEvent("redo"),
        );
        if (getSettings().mode !== "persisted") {
          this.clearScheduled();
        } else if (historyNavigation) {
          this.clearScheduled();
        } else if (
          (!ownTransaction && update.docChanged) ||
          (previousComposing && !this.wasComposing) ||
          settingsRefresh
        ) {
          this.schedule();
        }
      }

      destroy(): void {
        this.disposed = true;
        this.clearScheduled();
        unregisterEditorPath(this.view, this.path);
        activeEditorViews.delete(this.view);
      }

      private schedule(): void {
        if (!maintenance || this.disposed) return;
        this.clearScheduled();
        const ownerWindow = this.view.dom.ownerDocument.defaultView;
        if (!ownerWindow) return;
        this.timer = ownerWindow.setTimeout(() => {
          this.timer = null;
          void this.run();
        }, 350);
      }

      private clearScheduled(): void {
        if (this.timer === null) return;
        this.view.dom.ownerDocument.defaultView?.clearTimeout(this.timer);
        this.timer = null;
      }

      private async run(): Promise<void> {
        if (!maintenance || this.disposed) return;
        try {
          const result = await runEditorMaintenanceOnce({
            current: () => this.snapshot(),
            settings: getSettings,
            stage: maintenance.stage,
            cancel: maintenance.cancel,
            dispatch: (edits) => this.dispatch(edits),
          });
          if (result === "deferred" && isComposing(this.view)) this.schedule();
        } catch {
          // A failed durable stage or editor save must leave the user's buffer
          // untouched or the staged intent available for the recovery path.
        }
      }

      private snapshot(): EditorMaintenanceSnapshot {
        const path = this.disposed ? null : editorPath(this.view);
        return {
          path,
          text: this.view.state.doc.toString(),
          generation: this.generation,
          composing: this.view.composing,
          compositionStarted: this.view.compositionStarted,
          unique: path !== null && editorViewsByPath.get(path)?.size === 1,
        };
      }

      private dispatch(edits: readonly PlannedTextEdit[]): void {
        dispatchEditorEdits(this.view, edits);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function editingLine(
  view: EditorView,
): { readonly from: number; readonly to: number } | undefined {
  if (!view.hasFocus && !isComposing(view)) return undefined;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  return { from: line.from, to: line.to };
}

function editorInfo(view: EditorView): MarkdownFileInfo | null {
  return view.state.field(compatibleEditorInfoField, false) ?? null;
}

function editorPath(view: EditorView): string | null {
  return editorInfo(view)?.file?.path ?? null;
}

function editorSave(view: EditorView): (() => Promise<void>) | null {
  const info = editorInfo(view);
  if (!info) return null;
  const save: unknown = Reflect.get(info, "save");
  if (typeof save !== "function") return null;
  return async () => {
    await Reflect.apply(save, info, []);
  };
}

function isComposing(view: EditorView): boolean {
  return view.composing || view.compositionStarted;
}

function registerEditorPath(view: EditorView, path: string | null): void {
  if (path === null) return;
  const views = editorViewsByPath.get(path) ?? new Set<EditorView>();
  views.add(view);
  editorViewsByPath.set(path, views);
}

function unregisterEditorPath(view: EditorView, path: string | null): void {
  if (path === null) return;
  const views = editorViewsByPath.get(path);
  if (!views) return;
  views.delete(view);
  if (views.size === 0) {
    editorViewsByPath.delete(path);
    return;
  }
  for (const remaining of views) {
    remaining.dispatch({ effects: refreshHeadingKeeper.of(undefined) });
  }
}

function singleEditor(path: string):
  | { readonly kind: "closed" }
  | { readonly kind: "busy" }
  | {
      readonly kind: "ready";
      readonly view: EditorView;
      readonly save: () => Promise<void>;
    } {
  const views = editorViewsByPath.get(path);
  if (!views || views.size === 0) return { kind: "closed" };
  if (views.size !== 1) return { kind: "busy" };
  const view = [...views][0]!;
  const save = editorSave(view);
  if (!save || isComposing(view)) return { kind: "busy" };
  return { kind: "ready", view, save };
}

function dispatchEditorEdits(
  view: EditorView,
  edits: readonly PlannedTextEdit[],
): void {
  view.dispatch({
    changes: edits.map((edit) => ({
      from: edit.range.from,
      to: edit.range.to,
      insert: edit.replacementText,
    })),
    annotations: headingKeeperTransaction.of(true),
  });
}

export function refreshHeadingKeeperExtensions(): void {
  for (const view of activeEditorViews) {
    view.dispatch({ effects: refreshHeadingKeeper.of(undefined) });
  }
}

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import {
  planEditorMaterialization,
  runEditorMaintenanceOnce,
  type EditorMaintenanceSnapshot,
} from "../src/editor-maintenance.js";

function snapshot(
  update: Partial<EditorMaintenanceSnapshot> = {},
): EditorMaintenanceSnapshot {
  return {
    composing: false,
    compositionStarted: false,
    generation: 1,
    path: "Target.md",
    text: "### Alpha\n#### Child\n",
    unique: true,
    ...update,
  };
}

describe("persisted editor maintenance", () => {
  it("plans minimal heading edits and exact rename intents from the editor buffer", () => {
    const planned = planEditorMaterialization("Target.md", snapshot().text, {
      ...DEFAULT_STORED_SETTINGS,
      topLevel: 3,
      bottomLevel: 5,
      mode: "persisted",
    });

    expect(planned).toEqual({
      afterText: "### 1. Alpha\n#### 1.1. Child\n",
      edits: [
        {
          expectedText: "",
          range: { from: 4, to: 4 },
          replacementText: "1. ",
        },
        {
          expectedText: "",
          range: { from: 15, to: 15 },
          replacementText: "1.1. ",
        },
      ],
      renames: [
        {
          oldHeading: "Alpha",
          newHeading: "1. Alpha",
          targetPath: "Target.md",
        },
        {
          oldHeading: "Child",
          newHeading: "1.1. Child",
          targetPath: "Target.md",
        },
      ],
    });
  });

  it("performs no staging, dispatch, or save while an IME composition is active", async () => {
    const actions: string[] = [];

    const result = await runEditorMaintenanceOnce({
      cancel: async () => actions.push("cancel"),
      current: () => snapshot({ composing: true, compositionStarted: true }),
      dispatch: () => actions.push("dispatch"),
      save: async () => actions.push("save"),
      settings: () => ({
        ...DEFAULT_STORED_SETTINGS,
        topLevel: 3,
        bottomLevel: 5,
        mode: "persisted",
      }),
      stage: async () => {
        actions.push("stage");
        return "intent-1";
      },
    });

    expect(result).toBe("deferred");
    expect(actions).toEqual([]);
  });

  it("lets CodeMirror map a title-end cursor across the minimal prefix insertion", () => {
    const before = "## 标题";
    const planned = planEditorMaterialization("Target.md", before, {
      ...DEFAULT_STORED_SETTINGS,
      mode: "persisted",
    });
    const state = EditorState.create({
      doc: before,
      selection: { anchor: before.length },
    });

    const next = state.update({
      changes: planned?.edits.map((edit) => ({
        from: edit.range.from,
        to: edit.range.to,
        insert: edit.replacementText,
      })),
    }).state;

    expect(next.doc.toString()).toBe("## 1. 标题");
    expect(next.selection.main.head).toBe(next.doc.length);
  });

  it("cancels a staged intent when the editor changes before dispatch", async () => {
    const actions: string[] = [];
    let current = snapshot();
    let releaseStage!: () => void;
    const staged = new Promise<void>((resolve) => {
      releaseStage = resolve;
    });

    const running = runEditorMaintenanceOnce({
      cancel: async (id) => actions.push(`cancel:${id}`),
      current: () => current,
      dispatch: () => actions.push("dispatch"),
      save: async () => actions.push("save"),
      settings: () => ({
        ...DEFAULT_STORED_SETTINGS,
        topLevel: 3,
        bottomLevel: 5,
        mode: "persisted",
      }),
      stage: async () => {
        actions.push("stage");
        await staged;
        return "intent-1";
      },
    });

    current = snapshot({ generation: 2, text: "### PINYINAlpha\n" });
    releaseStage();

    await expect(running).resolves.toBe("stale");
    expect(actions).toEqual(["stage", "cancel:intent-1"]);
  });

  it("cancels a staged intent when numbering settings change before dispatch", async () => {
    const actions: string[] = [];
    let settings = {
      ...DEFAULT_STORED_SETTINGS,
      topLevel: 3,
      bottomLevel: 5,
      mode: "persisted" as const,
    };
    let releaseStage!: () => void;
    const staged = new Promise<void>((resolve) => {
      releaseStage = resolve;
    });

    const running = runEditorMaintenanceOnce({
      cancel: async (id) => actions.push(`cancel:${id}`),
      current: () => snapshot(),
      dispatch: () => actions.push("dispatch"),
      save: async () => actions.push("save"),
      settings: () => settings,
      stage: async () => {
        actions.push("stage");
        await staged;
        return "intent-settings";
      },
    });

    settings = { ...settings, startAt: 7 };
    releaseStage();

    await expect(running).resolves.toBe("stale");
    expect(actions).toEqual(["stage", "cancel:intent-settings"]);
  });

  it("keeps the original IME incident text intact apart from heading prefixes", () => {
    const before = [
      "## 操作步骤",
      "",
      "### 笔记内恢复",
      "",
      "正文保持原位。",
      "",
      "---",
      "",
      "### 通过插件查找并恢复",
      "",
      "下一节正文。",
      "",
    ].join("\n");

    const planned = planEditorMaterialization("Target.md", before, {
      ...DEFAULT_STORED_SETTINGS,
      topLevel: 3,
      bottomLevel: 5,
      mode: "persisted",
    });

    expect(planned?.afterText).toBe(
      [
        "## 操作步骤",
        "",
        "### 1. 笔记内恢复",
        "",
        "正文保持原位。",
        "",
        "---",
        "",
        "### 2. 通过插件查找并恢复",
        "",
        "下一节正文。",
        "",
      ].join("\n"),
    );
  });

  it("dispatches one editor transaction and saves only after the intent is durable", async () => {
    const actions: string[] = [];
    const current = snapshot();

    const result = await runEditorMaintenanceOnce({
      cancel: async (id) => actions.push(`cancel:${id}`),
      current: () => current,
      dispatch: (edits) => actions.push(`dispatch:${edits.length}`),
      save: async () => actions.push("save"),
      settings: () => ({
        ...DEFAULT_STORED_SETTINGS,
        topLevel: 3,
        bottomLevel: 5,
        mode: "persisted",
      }),
      stage: async () => {
        actions.push("stage");
        return "intent-1";
      },
    });

    expect(result).toBe("applied");
    expect(actions).toEqual(["stage", "dispatch:2", "save"]);
  });
});

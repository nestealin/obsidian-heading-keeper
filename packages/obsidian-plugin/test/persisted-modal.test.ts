import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ buttons: [] as FakeElement[] }));

class FakeElement {
  children: FakeElement[] = [];
  attrs = new Map<string, string>();
  disabled = false;
  listeners = new Map<string, () => void>();
  text = "";
  empty() {
    this.children = [];
  }
  createEl(_tag: string, options?: { text?: string }) {
    const child = new FakeElement();
    child.text = options?.text ?? "";
    this.children.push(child);
    if (_tag === "button") state.buttons.push(child);
    return child;
  }
  setAttr(name: string, value: string) {
    this.attrs.set(name, value);
  }
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }
}

function allText(element: FakeElement): string[] {
  return [element.text, ...element.children.flatMap(allText)].filter(Boolean);
}

vi.mock("obsidian", () => ({
  Modal: class Modal {
    contentEl = new FakeElement();
    closed = false;
    constructor(readonly app: unknown) {}
    open() {
      (this as { onOpen?: () => void }).onOpen?.();
    }
    close() {
      this.closed = true;
      (this as { onClose?: () => void }).onClose?.();
    }
  },
}));

import {
  PersistedPreviewModal,
  RecoveryCenterModal,
} from "../src/persisted-modal.js";

describe("persisted modals", () => {
  it("renders accessible preview groups and requires an explicit button", () => {
    state.buttons.length = 0;
    const confirm = vi.fn();
    const modal = new PersistedPreviewModal(
      {} as never,
      {
        previewKind: "add",
        targetPath: "Target.md",
        groups: {
          targetEdits: [
            {
              range: { from: 3, to: 4 },
              expectedText: "A",
              replacementText: "1. A",
            },
          ],
          linkSources: [
            {
              path: "Links.md",
              edits: [
                {
                  range: { from: 0, to: 10 },
                  expectedText: "[[#A]]",
                  replacementText: "[[#1. A]]",
                },
              ],
            },
          ],
          preserved: [{ path: "Other.md", code: "target-ambiguous" }],
          skips: [{ path: "Target.md", code: "missing-parent", line: 2 }],
          recoveryBoundary: [
            "source-hash-preflight",
            "external-change-preserved",
          ],
        },
      },
      "en",
      confirm,
    );

    modal.open();
    const root = modal.contentEl as unknown as FakeElement;
    expect(root.attrs.get("aria-label")).toBe("Persisted numbering preview");
    expect(allText(root)).toEqual(
      expect.arrayContaining([
        "Add persisted numbering — Target.md",
        "Target heading edits (1)",
        "Link sources (1)",
        "Preserved items (1)",
        "Skipped headings (1)",
        "Recovery boundary",
        "3-4: A → 1. A",
        "Links.md 0-10: [[#A]] → [[#1. A]]",
        "All source hashes are checked before the first write.",
        "Externally changed files are preserved during recovery.",
      ]),
    );
    state.buttons.at(-1)?.listeners.get("click")?.();
    state.buttons.at(-1)?.listeners.get("click")?.();
    expect(confirm).toHaveBeenCalledOnce();
    expect(state.buttons.at(-1)?.disabled).toBe(true);
    expect((modal as unknown as { closed: boolean }).closed).toBe(true);
  });

  it("localizes the remove action and exact edit details in Chinese", () => {
    state.buttons.length = 0;
    const modal = new PersistedPreviewModal(
      {} as never,
      {
        previewKind: "remove",
        targetPath: "目标.md",
        groups: {
          targetEdits: [
            {
              range: { from: 3, to: 6 },
              expectedText: "1. ",
              replacementText: "",
            },
          ],
          linkSources: [],
          preserved: [],
          skips: [],
          recoveryBoundary: ["source-hash-preflight"],
        },
      },
      "zh",
      vi.fn(),
    );

    modal.open();
    expect(allText(modal.contentEl as unknown as FakeElement)).toEqual(
      expect.arrayContaining([
        "移除写入编号 — 目标.md",
        "3-6: 1.  → （空）",
        "首次写入前会校验所有来源哈希。",
      ]),
    );
  });

  it("disables restore when no file is eligible", () => {
    state.buttons.length = 0;
    const restore = vi.fn();
    const modal = new RecoveryCenterModal(
      {} as never,
      [{ path: "Changed.md", role: "target", status: "changed" }],
      "en",
      restore,
    );

    modal.open();
    expect(state.buttons.at(-1)?.disabled).toBe(true);
    state.buttons.at(-1)?.listeners.get("click")?.();
    expect(restore).not.toHaveBeenCalled();
  });

  it("enables zero-write recovery finalization for pending and restored files", () => {
    state.buttons.length = 0;
    const restore = vi.fn();
    const modal = new RecoveryCenterModal(
      {} as never,
      [
        { path: "Pending.md", role: "target", status: "pending" },
        { path: "Restored.md", role: "link-source", status: "restored" },
      ],
      "en",
      restore,
    );

    modal.open();
    expect(state.buttons.at(-1)?.text).toBe("Complete recovery");
    expect(state.buttons.at(-1)?.disabled).toBe(false);
    state.buttons.at(-1)?.listeners.get("click")?.();
    state.buttons.at(-1)?.listeners.get("click")?.();
    expect(restore).toHaveBeenCalledOnce();
  });

  it("restores eligible files in a mixed eligible and changed inspection", () => {
    state.buttons.length = 0;
    const restore = vi.fn();
    const modal = new RecoveryCenterModal(
      {} as never,
      [
        { path: "Eligible.md", role: "target", status: "eligible" },
        { path: "Changed.md", role: "link-source", status: "changed" },
      ],
      "zh",
      restore,
    );

    modal.open();
    expect(state.buttons.at(-1)?.text).toBe("恢复可还原文件");
    expect(state.buttons.at(-1)?.disabled).toBe(false);
    state.buttons.at(-1)?.listeners.get("click")?.();
    expect(restore).toHaveBeenCalledOnce();
  });
});

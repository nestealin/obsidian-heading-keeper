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

vi.mock("obsidian", () => ({
  Modal: class Modal {
    contentEl = new FakeElement();
    constructor(readonly app: unknown) {}
    open() {
      (this as { onOpen?: () => void }).onOpen?.();
    }
    close() {
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
          linkSources: [{ path: "Links.md", edits: 1 }],
          preserved: [{ path: "Other.md", code: "target-ambiguous" }],
          skips: [{ path: "Target.md", code: "missing-parent", line: 2 }],
          recoveryBoundary: ["preflight", "no overwrite"],
        },
      },
      "en",
      confirm,
    );

    modal.open();
    const root = modal.contentEl as unknown as FakeElement;
    expect(root.attrs.get("aria-label")).toBe("Persisted numbering preview");
    expect(root.children.map((child) => child.text)).toEqual(
      expect.arrayContaining([
        "Target heading edits (1)",
        "Link sources (1)",
        "Preserved items (1)",
        "Skipped headings (1)",
        "Recovery boundary",
      ]),
    );
    state.buttons.at(-1)?.listeners.get("click")?.();
    expect(confirm).toHaveBeenCalledOnce();
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
});

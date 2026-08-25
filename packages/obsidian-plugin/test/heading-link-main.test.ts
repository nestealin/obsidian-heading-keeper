import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";

const state = vi.hoisted(() => ({
  content: new Map<string, string>(),
  commands: new Map<string, () => unknown>(),
  events: new Map<string, (...args: unknown[]) => unknown>(),
  loadedData: undefined as unknown,
  notices: [] as string[],
  modalOpens: 0,
  saves: [] as unknown[],
  writes: [] as string[],
}));

vi.mock("obsidian", () => {
  class TFile {
    readonly extension: string;
    constructor(readonly path: string) {
      this.extension = path.endsWith(".md") ? "md" : "txt";
    }
  }

  class Plugin {
    app = {
      workspace: {
        getActiveFile: () => null,
        on: () => ({}),
      },
      metadataCache: {
        getFirstLinkpathDest: (linkPath: string, sourcePath: string) => {
          if (linkPath === "" && sourcePath === "Target.md") {
            return new TFile("Target.md");
          }
          return linkPath === "Target" || linkPath === "Target.md"
            ? new TFile("Target.md")
            : null;
        },
      },
      vault: {
        getAbstractFileByPath: (path: string) =>
          state.content.has(path) ? new TFile(path) : null,
        getMarkdownFiles: () =>
          [...state.content.keys()].map((path) => new TFile(path)),
        modify: async (file: TFile, text: string) => {
          state.content.set(file.path, text);
          state.writes.push(file.path);
        },
        read: async (file: TFile) => state.content.get(file.path) ?? "",
        on: (name: string, callback: (...args: unknown[]) => unknown) => {
          state.events.set(name, callback);
          return {};
        },
      },
    };
    manifest = { id: "heading-keeper" };
    addCommand(command: { id: string; callback: () => unknown }) {
      state.commands.set(command.id, command.callback);
    }
    addSettingTab() {}
    registerEditorExtension() {}
    registerMarkdownPostProcessor() {}
    registerEvent() {}
    async loadData() {
      return state.loadedData;
    }
    async saveData(value: unknown) {
      state.saves.push(value);
    }
  }

  class PluginSettingTab {
    containerEl = { createEl: vi.fn(), empty: vi.fn() };
    constructor(
      readonly app: unknown,
      readonly plugin: unknown,
    ) {}
  }
  class Notice {
    constructor(message: string) {
      state.notices.push(message);
    }
  }
  class Modal {
    contentEl = {
      createEl: vi.fn(() => ({
        addEventListener: vi.fn(),
        createEl: vi.fn(),
        setAttr: vi.fn(),
      })),
      empty: vi.fn(),
      setAttr: vi.fn(),
    };
    constructor(readonly app: unknown) {}
    open() {
      state.modalOpens += 1;
      (this as { onOpen?: () => void }).onOpen?.();
    }
    close() {}
  }
  class MarkdownRenderChild {
    constructor(readonly containerEl: HTMLElement) {}
  }
  class Setting {
    setName() {
      return this;
    }
    setDesc() {
      return this;
    }
    addDropdown() {
      return this;
    }
    addText() {
      return this;
    }
    addButton() {
      return this;
    }
    addToggle() {
      return this;
    }
  }
  return {
    MarkdownRenderChild,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
  };
});

vi.mock("../src/editor-extension.js", () => ({
  createHeadingKeeperExtension: () => ({}),
  refreshHeadingKeeperExtensions: () => undefined,
}));

import { TFile } from "obsidian";
import { HeadingKeeperPlugin } from "../src/main.js";

beforeEach(() => {
  state.content.clear();
  state.commands.clear();
  state.events.clear();
  state.loadedData = undefined;
  state.notices.length = 0;
  state.modalOpens = 0;
  state.saves.length = 0;
  state.writes.length = 0;
});

describe("HeadingKeeper saved heading integration", () => {
  it("updates resolved heading links after one direct saved title rename", async () => {
    state.content.set("Target.md", "## Old title\n");
    state.content.set("Refs.md", "[[Target#Old title|alias]]");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    state.content.set("Target.md", "## New title\n");
    await state.events.get("modify")?.(new TFile("Target.md"));

    expect(state.writes).toEqual(["Refs.md"]);
    expect(state.content.get("Target.md")).toBe("## New title\n");
    expect(state.content.get("Refs.md")).toBe("[[Target#New title|alias]]");
    expect(state.notices).toContain("Heading links updated.");
  });

  it("preserves all link sources for a compound heading change", async () => {
    state.content.set("Target.md", "## A\n## B\n");
    state.content.set("Refs.md", "[[Target#A]] [[Target#B]]");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    state.content.set("Target.md", "## C\n## D\n");
    await state.events.get("modify")?.(new TFile("Target.md"));

    expect(state.writes).toEqual([]);
    expect(state.content.get("Refs.md")).toBe("[[Target#A]] [[Target#B]]");
    expect(state.notices).toContain(
      "Heading links were preserved because the rename was not unique.",
    );
  });

  it("keeps snapshots current while automatic synchronization is disabled", async () => {
    state.loadedData = {
      ...DEFAULT_STORED_SETTINGS,
      updateHeadingLinks: false,
    };
    state.content.set("Target.md", "## Old\n");
    state.content.set("Refs.md", "[[Target#Old]]");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    state.content.set("Target.md", "## New\n");
    await state.events.get("modify")?.(new TFile("Target.md"));

    expect(state.writes).toEqual([]);
    expect(state.content.get("Refs.md")).toBe("[[Target#Old]]");
  });

  it("audits historical heading links without writing any Vault file", async () => {
    state.content.set("Target.md", "## Existing\n");
    state.content.set("Refs.md", "[[Target#Missing]]");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    await state.commands.get("audit-heading-links")?.();

    expect(state.writes).toEqual([]);
    expect(state.modalOpens).toBe(1);
    expect(state.notices).toContain("Heading-link audit completed.");
  });
});

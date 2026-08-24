import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";

const state = vi.hoisted(() => ({
  commands: [] as Array<{ id: string; callback?: () => void }>,
  editorExtensions: [] as unknown[],
  loadedData: undefined as unknown,
  notices: [] as string[],
  postProcessors: [] as unknown[],
  renderChildren: [] as Array<{ onunload: () => void }>,
  readQueue: [] as Promise<string>[],
  readingMarkdown: new Map<string, string>(),
  savedData: [] as unknown[],
  settingRows: [] as Array<{
    controls: string[];
    description: string;
    name: string;
  }>,
  settingTabs: [] as unknown[],
  vaultWrites: 0,
}));

vi.mock("obsidian", () => {
  class Plugin {
    app = {
      setting: {
        open: vi.fn(),
        openTabById: vi.fn(),
      },
      vault: {
        getAbstractFileByPath: (path: string) => new TFile(path),
        modify: () => {
          state.vaultWrites += 1;
        },
        read: async (file: TFile) =>
          state.readQueue.shift() ?? state.readingMarkdown.get(file.path) ?? "",
      },
    };
    manifest = { id: "heading-numbering" };

    addCommand(command: { id: string; callback?: () => void }) {
      state.commands.push(command);
    }

    registerEditorExtension(extension: unknown) {
      state.editorExtensions.push(extension);
    }

    registerMarkdownPostProcessor(processor: unknown) {
      state.postProcessors.push(processor);
    }

    addSettingTab(tab: unknown) {
      state.settingTabs.push(tab);
    }

    async loadData() {
      return state.loadedData;
    }

    async saveData(value: unknown) {
      state.savedData.push(value);
    }
  }

  class PluginSettingTab {
    containerEl = {
      createEl: vi.fn(),
      empty: vi.fn(),
    };

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

  class TFile {
    constructor(readonly path: string) {}
  }

  class MarkdownRenderChild {
    constructor(readonly containerEl: HTMLElement) {}

    onunload(): void {}
  }

  class Setting {
    private readonly row = {
      controls: [] as string[],
      description: "",
      name: "",
    };

    constructor(_containerEl: unknown) {
      state.settingRows.push(this.row);
    }

    setName(name: string) {
      this.row.name = name;
      return this;
    }

    setDesc(description: string) {
      this.row.description = description;
      return this;
    }

    addDropdown(callback: (component: Dropdown) => void) {
      this.row.controls.push("dropdown");
      callback(new Dropdown());
      return this;
    }

    addText(callback: (component: TextComponent) => void) {
      this.row.controls.push("text");
      callback(new TextComponent());
      return this;
    }
  }

  class Dropdown {
    addOption() {
      return this;
    }

    onChange() {
      return this;
    }

    setValue() {
      return this;
    }
  }

  class TextComponent {
    onChange() {
      return this;
    }

    setValue() {
      return this;
    }
  }

  return {
    MarkdownRenderChild,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
  };
});

import { HeadingNumberingPlugin } from "../src/main.js";

beforeEach(() => {
  state.commands.length = 0;
  state.editorExtensions.length = 0;
  state.loadedData = undefined;
  state.notices.length = 0;
  state.postProcessors.length = 0;
  state.renderChildren.length = 0;
  state.readQueue.length = 0;
  state.readingMarkdown.clear();
  state.savedData.length = 0;
  state.settingRows.length = 0;
  state.settingTabs.length = 0;
  state.vaultWrites = 0;
});

describe("HeadingNumberingPlugin", () => {
  it("loads virtual defaults and registers only the five stable commands", async () => {
    const plugin = new HeadingNumberingPlugin();

    await plugin.onload();

    expect(plugin.settings).toMatchObject({
      topLevel: 2,
      bottomLevel: 6,
      mode: "virtual",
      locale: "auto",
    });
    expect(state.commands.map((command) => command.id)).toEqual([
      "preview-persisted",
      "apply-persisted",
      "remove-confirmed",
      "refresh-virtual",
      "open-settings",
    ]);
    expect(state.settingTabs).toHaveLength(1);
    expect(state.editorExtensions).toHaveLength(1);
    expect(state.postProcessors).toHaveLength(1);
    expect(state.vaultWrites).toBe(0);
  });

  it("keeps the last valid settings and exposes field errors when persisted data is invalid", async () => {
    state.loadedData = { ...DEFAULT_STORED_SETTINGS, topLevel: 0 };
    const plugin = new HeadingNumberingPlugin();

    await plugin.onload();

    expect(plugin.settings.topLevel).toBe(2);
    expect(plugin.settingsErrors).toEqual([
      { field: "topLevel", message: "Expected an integer from 1 through 6." },
    ]);
  });

  it("saves only valid settings and leaves vault writes to later explicit operations", async () => {
    const plugin = new HeadingNumberingPlugin();
    await plugin.onload();

    await expect(
      plugin.saveSettings({ ...plugin.settings, locale: "zh" }),
    ).resolves.toBe(true);
    await expect(
      plugin.saveSettings({ ...plugin.settings, topLevel: 0 }),
    ).resolves.toBe(false);

    expect(state.savedData).toEqual([
      expect.objectContaining({ locale: "zh", topLevel: 2 }),
    ]);
    expect(plugin.settings.locale).toBe("zh");
    expect(state.vaultWrites).toBe(0);
  });

  it("saves every settings field and restores the saved value after reload", async () => {
    const plugin = new HeadingNumberingPlugin();
    await plugin.onload();
    const updates = [
      { mode: "persisted" },
      { topLevel: 3 },
      { bottomLevel: 5 },
      { startAt: 2 },
      { numberSeparator: "-" },
      { titleSeparator: " — " },
      { gapStrategy: "skip" },
      { locale: "zh" },
    ];

    for (const update of updates) {
      await expect(
        plugin.saveSettings({ ...plugin.settings, ...update }),
      ).resolves.toBe(true);
    }

    state.loadedData = state.savedData.at(-1);
    const reloaded = new HeadingNumberingPlugin();
    await reloaded.onload();

    expect(reloaded.settings).toEqual({
      topLevel: 3,
      bottomLevel: 5,
      startAt: 2,
      numberSeparator: "-",
      titleSeparator: " — ",
      gapStrategy: "skip",
      mode: "persisted",
      locale: "zh",
    });
  });

  it("retains the last valid mode when an invalid mode is saved", async () => {
    const plugin = new HeadingNumberingPlugin();
    await plugin.onload();
    await plugin.saveSettings({ ...plugin.settings, mode: "persisted" });

    await expect(
      plugin.saveSettings({ ...plugin.settings, mode: "background" }),
    ).resolves.toBe(false);

    expect(plugin.settings.mode).toBe("persisted");
    expect(plugin.settingsErrors).toEqual([
      { field: "mode", message: "Expected virtual or persisted." },
    ]);
  });

  it("renders controls and descriptions for every stored setting", async () => {
    const plugin = new HeadingNumberingPlugin();
    await plugin.onload();
    const tab = state.settingTabs[0] as { display: () => void };

    tab.display();

    expect(state.settingRows.map((row) => row.name)).toEqual([
      "Numbering mode",
      "Top heading level",
      "Bottom heading level",
      "Start at",
      "Number separator",
      "Title separator",
      "Gap strategy",
      "Language",
    ]);
    expect(state.settingRows.every((row) => row.description.length > 0)).toBe(
      true,
    );
  });

  it("refreshes owned Reading prefixes on settings changes and cleans them on unload", async () => {
    const root = createReadingRoot(2);
    state.readingMarkdown.set("virtual.md", "## Root");
    const plugin = new HeadingNumberingPlugin();
    await plugin.onload();
    const processor = state.postProcessors[0] as (
      root: HTMLElement,
      context: { sourcePath: string },
    ) => Promise<void>;

    await processor(root as unknown as HTMLElement, readingContext());
    expect(root.prefixes()).toEqual(["1. "]);

    await plugin.saveSettings({ ...plugin.settings, titleSeparator: " · " });
    expect(root.prefixes()).toEqual(["1 · "]);

    plugin.onunload();
    expect(root.prefixes()).toEqual([]);
    expect(state.vaultWrites).toBe(0);
  });

  it("maps separate Reading sections to global heading numbers", async () => {
    const firstRoot = createReadingRoot(2);
    const secondRoot = createReadingRoot(2);
    state.readingMarkdown.set("virtual.md", "## A\n## B");
    const plugin = new HeadingNumberingPlugin();
    await plugin.onload();
    const processor = state.postProcessors[0] as (
      root: HTMLElement,
      context: ReturnType<typeof readingContext>,
    ) => Promise<void>;

    await processor(
      firstRoot as unknown as HTMLElement,
      readingContext({ lineEnd: 0, lineStart: 0 }),
    );
    await processor(
      secondRoot as unknown as HTMLElement,
      readingContext({ lineEnd: 1, lineStart: 1 }),
    );

    expect(firstRoot.prefixes()).toEqual(["1. "]);
    expect(secondRoot.prefixes()).toEqual(["2. "]);
  });

  it("keeps an unloaded Reading child and a late vault read from decorating", async () => {
    const root = createReadingRoot(2);
    const delayed = deferred<string>();
    state.readQueue.push(delayed.promise);
    const plugin = new HeadingNumberingPlugin();
    await plugin.onload();
    const processor = state.postProcessors[0] as (
      root: HTMLElement,
      context: ReturnType<typeof readingContext>,
    ) => Promise<void>;

    const rendering = processor(
      root as unknown as HTMLElement,
      readingContext(),
    );
    expect(state.renderChildren).toHaveLength(1);
    state.renderChildren[0]?.onunload();
    delayed.resolve("## Root");
    await rendering;

    expect(root.prefixes()).toEqual([]);
    await plugin.saveSettings({ ...plugin.settings, titleSeparator: " · " });
    expect(root.prefixes()).toEqual([]);
  });

  it("does not decorate when plugin unload precedes a vault read resolution", async () => {
    const root = createReadingRoot(2);
    const delayed = deferred<string>();
    state.readQueue.push(delayed.promise);
    const plugin = new HeadingNumberingPlugin();
    await plugin.onload();
    const processor = state.postProcessors[0] as (
      root: HTMLElement,
      context: ReturnType<typeof readingContext>,
    ) => Promise<void>;

    const rendering = processor(
      root as unknown as HTMLElement,
      readingContext(),
    );
    plugin.onunload();
    delayed.resolve("## Root");
    await rendering;

    expect(root.prefixes()).toEqual([]);
  });

  it("keeps the newest concurrent Reading request when an older read resolves late", async () => {
    const root = createReadingRoot(2);
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    state.readQueue.push(firstRead.promise, secondRead.promise);
    const plugin = new HeadingNumberingPlugin();
    await plugin.onload();
    const processor = state.postProcessors[0] as (
      root: HTMLElement,
      context: ReturnType<typeof readingContext>,
    ) => Promise<void>;
    const context = readingContext({ lineEnd: 1, lineStart: 1 });

    const firstRendering = processor(root as unknown as HTMLElement, context);
    const refresh = plugin.saveSettings({ ...plugin.settings });
    secondRead.resolve("## First\n## Second");
    await refresh;
    expect(root.prefixes()).toEqual(["2. "]);

    firstRead.resolve("## First");
    await firstRendering;
    expect(root.prefixes()).toEqual(["2. "]);
  });
});

function readingContext(
  section: { lineEnd: number; lineStart: number } | null = {
    lineEnd: 0,
    lineStart: 0,
  },
) {
  return {
    addChild(child: { onunload: () => void }) {
      state.renderChildren.push(child);
    },
    getSectionInfo() {
      return section;
    },
    sourcePath: "virtual.md",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createReadingRoot(level: number) {
  class ReadingElement {
    readonly attributes = new Map<string, string>();
    readonly children: ReadingElement[] = [];
    className = "";
    parentElement: ReadingElement | undefined;
    textContent = "";

    constructor(readonly tagName: string) {}

    get firstChild(): ReadingElement | undefined {
      return this.children[0];
    }

    readonly ownerDocument = {
      createElement: (tagName: string) =>
        new ReadingElement(tagName.toUpperCase()),
    };

    appendChild(child: ReadingElement): void {
      child.parentElement = this;
      this.children.push(child);
    }

    insertBefore(
      child: ReadingElement,
      before: ReadingElement | undefined,
    ): void {
      child.parentElement = this;
      const index = before ? this.children.indexOf(before) : -1;
      if (index < 0) {
        this.children.push(child);
      } else {
        this.children.splice(index, 0, child);
      }
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

    querySelectorAll(selector: string): ReadingElement[] {
      const headingSelector = selector === "h1, h2, h3, h4, h5, h6";
      const result: ReadingElement[] = [];
      const visit = (node: ReadingElement): void => {
        for (const child of node.children) {
          if (
            (headingSelector && /^H[1-6]$/.test(child.tagName)) ||
            (selector === ".heading-numbering-prefix" &&
              child.className === "heading-numbering-prefix")
          ) {
            result.push(child);
          }
          visit(child);
        }
      };
      visit(this);
      return result;
    }

    prefixes(): string[] {
      return this.querySelectorAll(".heading-numbering-prefix").map(
        (prefix) => prefix.textContent,
      );
    }
  }

  const root = new ReadingElement("DIV");
  root.appendChild(new ReadingElement(`H${level}`));
  return root;
}

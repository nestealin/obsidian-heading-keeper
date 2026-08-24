import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";

const state = vi.hoisted(() => ({
  commands: [] as Array<{ id: string; callback?: () => void }>,
  loadedData: undefined as unknown,
  notices: [] as string[],
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
        modify: () => {
          state.vaultWrites += 1;
        },
      },
    };
    manifest = { id: "heading-numbering" };

    addCommand(command: { id: string; callback?: () => void }) {
      state.commands.push(command);
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

  return { Notice, Plugin, PluginSettingTab, Setting };
});

import { HeadingNumberingPlugin } from "../src/main.js";

beforeEach(() => {
  state.commands.length = 0;
  state.loadedData = undefined;
  state.notices.length = 0;
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
});

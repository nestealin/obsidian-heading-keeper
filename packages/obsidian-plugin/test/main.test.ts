import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";

const state = vi.hoisted(() => ({
  commands: [] as Array<{ id: string; callback?: () => void }>,
  loadedData: undefined as unknown,
  notices: [] as string[],
  savedData: [] as unknown[],
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

  class Setting {}

  return { Notice, Plugin, PluginSettingTab, Setting };
});

import { HeadingNumberingPlugin } from "../src/main.js";

beforeEach(() => {
  state.commands.length = 0;
  state.loadedData = undefined;
  state.notices.length = 0;
  state.savedData.length = 0;
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
});

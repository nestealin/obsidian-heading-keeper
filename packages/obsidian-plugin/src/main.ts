import { Notice, Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import {
  resolveLocale,
  translate,
  type Locale,
  type LocalePreference,
} from "./i18n.js";
import {
  DEFAULT_STORED_SETTINGS,
  type StoredSettings,
  validateStoredSettings,
} from "./settings.js";
import type { FieldError } from "@heading-numbering/core";

export { resolveLocale, translate } from "./i18n.js";
export type { StoredSettings } from "./settings.js";

const commandIds = {
  apply: "apply-persisted",
  openSettings: "open-settings",
  preview: "preview-persisted",
  refresh: "refresh-virtual",
  remove: "remove-confirmed",
} as const;

class HeadingNumberingSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly headingNumbering: HeadingNumberingPlugin,
  ) {
    super(app, headingNumbering);
  }

  display(): void {
    const locale = this.headingNumbering.currentLocale();
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: translate(locale, "settings.heading") });

    new Setting(containerEl)
      .setName(translate(locale, "settings.locale"))
      .setDesc(translate(locale, "settings.localeDescription"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", translate(locale, "locale.auto"))
          .addOption("en", translate(locale, "locale.en"))
          .addOption("zh", translate(locale, "locale.zh"))
          .setValue(this.headingNumbering.settings.locale)
          .onChange(async (value) => {
            await this.headingNumbering.saveSettings({
              ...this.headingNumbering.settings,
              locale: value as LocalePreference,
            });
            this.display();
          });
      });

    containerEl.createEl("p", {
      text: translate(locale, "settings.persistenceBoundary"),
    });
    if (this.headingNumbering.settingsErrors.length > 0) {
      containerEl.createEl("p", {
        text: `${translate(locale, "settings.errors")} ${this.headingNumbering.settingsErrors
          .map((error) => error.field)
          .join(", ")}`,
      });
    }
  }
}

export class HeadingNumberingPlugin extends Plugin {
  settings: StoredSettings = { ...DEFAULT_STORED_SETTINGS };
  settingsErrors: FieldError[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new HeadingNumberingSettingTab(this.app, this));
    this.addCommand({
      id: commandIds.preview,
      name: translate(this.currentLocale(), "commands.preview"),
      callback: () => this.showNotice("notices.preview"),
    });
    this.addCommand({
      id: commandIds.apply,
      name: translate(this.currentLocale(), "commands.apply"),
      callback: () => this.showNotice("notices.apply"),
    });
    this.addCommand({
      id: commandIds.remove,
      name: translate(this.currentLocale(), "commands.remove"),
      callback: () => this.showNotice("notices.remove"),
    });
    this.addCommand({
      id: commandIds.refresh,
      name: translate(this.currentLocale(), "commands.refresh"),
      callback: () => this.showNotice("notices.refresh"),
    });
    this.addCommand({
      id: commandIds.openSettings,
      name: translate(this.currentLocale(), "commands.openSettings"),
      callback: () => this.showNotice("notices.openSettings"),
    });
  }

  onunload(): void {}

  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    if (saved === null || saved === undefined) {
      this.settingsErrors = [];
      return;
    }
    const validation = validateStoredSettings(saved);
    if (validation.ok) {
      this.settings = validation.value;
      this.settingsErrors = [];
      return;
    }
    this.settingsErrors = validation.errors;
  }

  async saveSettings(next: unknown): Promise<boolean> {
    const validation = validateStoredSettings(next);
    if (!validation.ok) {
      this.settingsErrors = validation.errors;
      return false;
    }
    this.settings = validation.value;
    this.settingsErrors = [];
    await this.saveData(this.settings);
    return true;
  }

  currentLocale(): Locale {
    const systemLocale =
      typeof navigator === "undefined" ? "en" : navigator.language;
    return resolveLocale(this.settings.locale, systemLocale);
  }

  private showNotice(
    key:
      | "notices.preview"
      | "notices.apply"
      | "notices.remove"
      | "notices.refresh"
      | "notices.openSettings",
  ): void {
    new Notice(translate(this.currentLocale(), key));
  }
}

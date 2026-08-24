import { Notice, Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import {
  resolveLocale,
  translate,
  type Locale,
  type LocalePreference,
} from "./i18n.js";
import {
  DEFAULT_STORED_SETTINGS,
  type NumberingMode,
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

export class HeadingNumberingSettingTab extends PluginSettingTab {
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
      .setName(translate(locale, "settings.mode"))
      .setDesc(translate(locale, "settings.modeDescription"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("virtual", translate(locale, "mode.virtual"))
          .addOption("persisted", translate(locale, "mode.persisted"))
          .setValue(this.headingNumbering.settings.mode)
          .onChange(async (value) => {
            await this.save({ mode: value as NumberingMode });
          });
      });

    this.addNumberField(
      locale,
      "settings.topLevel",
      "settings.topLevelDescription",
      this.headingNumbering.settings.topLevel,
      (topLevel) => ({ topLevel }),
    );
    this.addNumberField(
      locale,
      "settings.bottomLevel",
      "settings.bottomLevelDescription",
      this.headingNumbering.settings.bottomLevel,
      (bottomLevel) => ({ bottomLevel }),
    );
    this.addNumberField(
      locale,
      "settings.startAt",
      "settings.startAtDescription",
      this.headingNumbering.settings.startAt,
      (startAt) => ({ startAt }),
    );
    this.addTextField(
      locale,
      "settings.numberSeparator",
      "settings.numberSeparatorDescription",
      this.headingNumbering.settings.numberSeparator,
      (numberSeparator) => ({ numberSeparator }),
    );
    this.addTextField(
      locale,
      "settings.titleSeparator",
      "settings.titleSeparatorDescription",
      this.headingNumbering.settings.titleSeparator,
      (titleSeparator) => ({ titleSeparator }),
    );
    new Setting(containerEl)
      .setName(translate(locale, "settings.gapStrategy"))
      .setDesc(translate(locale, "settings.gapStrategyDescription"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("zero-fill", translate(locale, "gapStrategy.zeroFill"))
          .addOption("one-fill", translate(locale, "gapStrategy.oneFill"))
          .addOption("compact", translate(locale, "gapStrategy.compact"))
          .addOption("skip", translate(locale, "gapStrategy.skip"))
          .setValue(this.headingNumbering.settings.gapStrategy)
          .onChange(async (gapStrategy) => {
            await this.save({
              gapStrategy: gapStrategy as StoredSettings["gapStrategy"],
            });
          });
      });

    new Setting(containerEl)
      .setName(translate(locale, "settings.locale"))
      .setDesc(translate(locale, "settings.localeDescription"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("auto", translate(locale, "locale.auto"))
          .addOption("en", translate(locale, "locale.en"))
          .addOption("zh", translate(locale, "locale.zh"))
          .setValue(this.headingNumbering.settings.locale)
          .onChange(async (localePreference) => {
            await this.save({ locale: localePreference as LocalePreference });
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

  private addNumberField(
    locale: Locale,
    name: "settings.topLevel" | "settings.bottomLevel" | "settings.startAt",
    description:
      | "settings.topLevelDescription"
      | "settings.bottomLevelDescription"
      | "settings.startAtDescription",
    value: number,
    update: (value: number) => Record<string, unknown>,
  ): void {
    new Setting(this.containerEl)
      .setName(translate(locale, name))
      .setDesc(translate(locale, description))
      .addText((text) => {
        text.setValue(String(value)).onChange(async (nextValue) => {
          await this.save(update(Number(nextValue)));
        });
      });
  }

  private addTextField(
    locale: Locale,
    name: "settings.numberSeparator" | "settings.titleSeparator",
    description:
      | "settings.numberSeparatorDescription"
      | "settings.titleSeparatorDescription",
    value: string,
    update: (value: string) => Record<string, unknown>,
  ): void {
    new Setting(this.containerEl)
      .setName(translate(locale, name))
      .setDesc(translate(locale, description))
      .addText((text) => {
        text.setValue(value).onChange(async (nextValue) => {
          await this.save(update(nextValue));
        });
      });
  }

  private async save(update: Record<string, unknown>): Promise<void> {
    await this.headingNumbering.saveSettings({
      ...this.headingNumbering.settings,
      ...update,
    });
    this.display();
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

export default HeadingNumberingPlugin;

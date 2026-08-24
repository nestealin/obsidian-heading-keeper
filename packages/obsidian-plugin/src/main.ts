import {
  Notice,
  MarkdownRenderChild,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  type App,
} from "obsidian";
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
import {
  createHeadingNumberingExtension,
  refreshHeadingNumberingExtensions,
} from "./editor-extension.js";
import {
  decorateReadingHeadings,
  disposeReadingRoot,
  registerReadingRoot,
  type ReadingSection,
} from "./reading-processor.js";

export { resolveLocale, translate } from "./i18n.js";
export type { StoredSettings } from "./settings.js";

const commandIds = {
  apply: "apply-persisted",
  openSettings: "open-settings",
  preview: "preview-persisted",
  refresh: "refresh-virtual",
  remove: "remove-confirmed",
} as const;

interface ReadingRootState {
  request: number;
  section: ReadingSection | null;
  sourcePath: string;
  token: object;
}

interface ReadingRequest {
  generation: number;
  request: number;
}

class ReadingRenderChild extends MarkdownRenderChild {
  constructor(
    root: HTMLElement,
    private readonly release: () => void,
  ) {
    super(root);
  }

  onunload(): void {
    this.release();
  }
}

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
  private disposed = false;
  private renderGeneration = 0;
  private readonly readingRoots = new Map<HTMLElement, ReadingRootState>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new HeadingNumberingSettingTab(this.app, this));
    this.registerEditorExtension(
      createHeadingNumberingExtension(() => this.settings),
    );
    this.registerMarkdownPostProcessor(async (root, context) => {
      const token = {};
      context.addChild(
        new ReadingRenderChild(root, () =>
          this.releaseReadingRoot(root, token),
        ),
      );
      const sectionInfo = context.getSectionInfo(root);
      const section = sectionInfo
        ? { lineEnd: sectionInfo.lineEnd, lineStart: sectionInfo.lineStart }
        : null;
      const state: ReadingRootState = {
        request: 0,
        section,
        sourcePath: context.sourcePath,
        token,
      };
      this.readingRoots.set(root, state);
      registerReadingRoot(root, section, context.sourcePath);
      if (await this.decorateReadingRoot(root, state)) {
        await this.refreshReadingAncestors(root);
      }
    });
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
      callback: () => {
        void this.refreshVirtualRendering();
        this.showNotice("notices.refresh");
      },
    });
    this.addCommand({
      id: commandIds.openSettings,
      name: translate(this.currentLocale(), "commands.openSettings"),
      callback: () => this.showNotice("notices.openSettings"),
    });
  }

  onunload(): void {
    this.disposed = true;
    this.renderGeneration += 1;
    for (const root of this.readingRoots.keys()) {
      disposeReadingRoot(root);
    }
    this.readingRoots.clear();
  }

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
    await this.refreshVirtualRendering();
    return true;
  }

  currentLocale(): Locale {
    const systemLocale =
      typeof navigator === "undefined" ? "en" : navigator.language;
    return resolveLocale(this.settings.locale, systemLocale);
  }

  private async decorateReadingRoot(
    root: HTMLElement,
    state: ReadingRootState,
  ): Promise<boolean> {
    const readingRequest = this.beginReadingRequest(state);
    if (!state.section) {
      if (this.isReadingRequestCurrent(root, state, readingRequest)) {
        decorateReadingHeadings(
          root,
          "",
          this.settings,
          null,
          state.sourcePath,
        );
        return true;
      }
      return false;
    }

    const file = this.app.vault.getAbstractFileByPath(state.sourcePath);
    if (!(file instanceof TFile)) {
      if (this.isReadingRequestCurrent(root, state, readingRequest)) {
        disposeReadingRoot(root);
        return true;
      }
      return false;
    }
    const markdown = await this.app.vault.read(file);
    return this.applyReadingMarkdown(root, state, readingRequest, markdown);
  }

  private async refreshReadingAncestors(root: HTMLElement): Promise<void> {
    if (this.disposed) {
      return;
    }
    const batches = new Map<
      string,
      Array<{
        root: HTMLElement;
        state: ReadingRootState;
        request: ReadingRequest;
      }>
    >();
    for (const [candidate, state] of this.readingRoots) {
      if (candidate === root || !this.isReadingAncestor(candidate, root)) {
        continue;
      }
      const request = this.beginReadingRequest(state);
      if (!state.section) {
        if (this.isReadingRequestCurrent(candidate, state, request)) {
          decorateReadingHeadings(
            candidate,
            "",
            this.settings,
            null,
            state.sourcePath,
          );
        }
        continue;
      }
      const batch = batches.get(state.sourcePath) ?? [];
      batch.push({ root: candidate, state, request });
      batches.set(state.sourcePath, batch);
    }
    await Promise.all(
      Array.from(batches, async ([sourcePath, batch]) => {
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile)) {
          for (const target of batch) {
            if (
              this.isReadingRequestCurrent(
                target.root,
                target.state,
                target.request,
              )
            ) {
              disposeReadingRoot(target.root);
            }
          }
          return;
        }
        const markdown = await this.app.vault.read(file);
        for (const target of batch) {
          this.applyReadingMarkdown(
            target.root,
            target.state,
            target.request,
            markdown,
          );
        }
      }),
    );
  }

  private async refreshVirtualRendering(): Promise<void> {
    if (this.disposed) {
      return;
    }
    refreshHeadingNumberingExtensions();
    await Promise.all(
      Array.from(this.readingRoots, async ([root, state]) => {
        await this.decorateReadingRoot(root, state);
      }),
    );
  }

  private isReadingRequestCurrent(
    root: HTMLElement,
    state: ReadingRootState,
    request: ReadingRequest,
  ): boolean {
    return (
      !this.disposed &&
      this.renderGeneration === request.generation &&
      this.readingRoots.get(root) === state &&
      state.request === request.request
    );
  }

  private beginReadingRequest(state: ReadingRootState): ReadingRequest {
    const request = state.request + 1;
    state.request = request;
    return { generation: this.renderGeneration, request };
  }

  private applyReadingMarkdown(
    root: HTMLElement,
    state: ReadingRootState,
    request: ReadingRequest,
    markdown: string,
  ): boolean {
    if (!this.isReadingRequestCurrent(root, state, request)) {
      return false;
    }
    decorateReadingHeadings(
      root,
      markdown,
      this.settings,
      state.section,
      state.sourcePath,
    );
    return true;
  }

  private isReadingAncestor(ancestor: HTMLElement, root: HTMLElement): boolean {
    let current = root.parentElement;
    while (current) {
      if (current === ancestor) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  private releaseReadingRoot(root: HTMLElement, token: object): void {
    const state = this.readingRoots.get(root);
    if (!state || state.token !== token) {
      return;
    }
    this.readingRoots.delete(root);
    disposeReadingRoot(root);
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

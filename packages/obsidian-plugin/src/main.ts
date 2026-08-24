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
import { PluginDataStore } from "./plugin-data.js";
import {
  createObsidianLinkResolver,
  ObsidianVaultFileAdapter,
} from "./obsidian-adapters.js";
import {
  buildWorkflowPreview,
  type WorkflowPreviewKind,
  type WorkflowPreviewResult,
} from "./persisted-workflow.js";
import {
  PersistedPreviewModal,
  RecoveryCenterModal,
} from "./persisted-modal.js";
import {
  executePersistedOperation,
  inspectRecovery,
  restoreEligibleFiles,
} from "./persistence/executor.js";
import { sha256Text } from "./persistence/plan-service.js";
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

    new Setting(containerEl)
      .setName(translate(locale, "settings.recovery"))
      .setDesc(translate(locale, "settings.recoveryDescription"))
      .addButton((button) => {
        button
          .setButtonText(translate(locale, "settings.openRecovery"))
          .onClick(() => {
            void this.headingNumbering.openRecoveryCenter();
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
  private lifecycleGeneration = 0;
  private previewGeneration = 0;
  private previewWasInvalidated = false;
  private settingsSaveInFlight = 0;
  private dataStore: PluginDataStore | null = null;
  private vaultAdapter: ObsidianVaultFileAdapter | null = null;
  private currentPreview: Extract<
    WorkflowPreviewResult,
    { kind: "preview" }
  > | null = null;
  private applyInFlight: { planId: string; token: object } | null = null;
  private previewModal: {
    planId: string;
    modal: PersistedPreviewModal;
    nonce: object;
  } | null = null;
  private readonly recoveryNonces = new Map<string, object>();
  private readonly recoveryInFlight = new Map<string, object>();
  private readonly openModals = new Set<{ close(): void }>();
  private readonly readingRoots = new Map<HTMLElement, ReadingRootState>();

  get activePreview(): Extract<
    WorkflowPreviewResult,
    { kind: "preview" }
  > | null {
    return this.currentPreview;
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.vaultAdapter = new ObsidianVaultFileAdapter(this.app.vault);
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
      callback: () => {
        void this.previewPersisted("add");
      },
    });
    this.addCommand({
      id: commandIds.apply,
      name: translate(this.currentLocale(), "commands.apply"),
      callback: () => {
        void this.applyCurrentPreview();
      },
    });
    this.addCommand({
      id: commandIds.remove,
      name: translate(this.currentLocale(), "commands.remove"),
      callback: () => {
        void this.previewPersisted("remove");
      },
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
      callback: () => this.openSettings(),
    });
    this.registerEvent(
      this.app.workspace.on("file-open", () =>
        this.invalidatePersistedPreview(),
      ),
    );
    this.registerEvent(
      this.app.vault.on("modify", () => this.invalidatePersistedPreview()),
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.invalidatePersistedPreview()),
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.invalidatePersistedPreview()),
    );
    if ((this.dataStore?.recoveryOperations().length ?? 0) > 0) {
      this.showNotice("notices.recoveryAvailable");
    }
  }

  onunload(): void {
    this.disposed = true;
    this.renderGeneration += 1;
    this.lifecycleGeneration += 1;
    this.previewGeneration += 1;
    this.currentPreview = null;
    this.applyInFlight = null;
    this.previewModal = null;
    this.recoveryNonces.clear();
    this.recoveryInFlight.clear();
    for (const modal of this.openModals) modal.close();
    this.openModals.clear();
    for (const root of this.readingRoots.keys()) {
      disposeReadingRoot(root);
    }
    this.readingRoots.clear();
  }

  async loadSettings(): Promise<void> {
    this.dataStore = new PluginDataStore(
      () => this.loadData(),
      (value) => this.saveData(value),
      sha256Text,
    );
    const loaded = await this.dataStore.initialize();
    this.settings = loaded.settings;
    this.settingsErrors = [...loaded.settingsErrors];
  }

  async saveSettings(next: unknown): Promise<boolean> {
    const validation = validateStoredSettings(next);
    if (!validation.ok) {
      this.settingsErrors = validation.errors;
      return false;
    }
    this.settingsSaveInFlight += 1;
    this.invalidatePersistedPreview();
    try {
      if (!this.dataStore) {
        this.dataStore = new PluginDataStore(
          () => this.loadData(),
          (value) => this.saveData(value),
          sha256Text,
        );
        await this.dataStore.initialize();
      }
      const saved = await this.dataStore.saveSettings(validation.value);
      if (!saved.ok) {
        this.settingsErrors = [...saved.errors];
        return false;
      }
      this.settings = saved.settings;
      this.settingsErrors = [];
      await this.refreshVirtualRendering();
      return true;
    } catch {
      this.showNotice("notices.storageError");
      return false;
    } finally {
      this.settingsSaveInFlight -= 1;
    }
  }

  async previewPersisted(kind: WorkflowPreviewKind): Promise<void> {
    if (this.settingsSaveInFlight > 0) {
      this.showNotice("notices.settingsSaving");
      return;
    }
    if (this.settings.mode !== "persisted") {
      this.showNotice("notices.persistedModeRequired");
      return;
    }
    const active = this.app.workspace.getActiveFile();
    if (!(active instanceof TFile) || active.extension !== "md") {
      this.showNotice("notices.activeMarkdownRequired");
      return;
    }
    const generation = ++this.previewGeneration;
    this.currentPreview = null;
    this.previewWasInvalidated = false;
    try {
      const files = this.app.vault
        .getMarkdownFiles()
        .slice()
        .sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        );
      const sources = await Promise.all(
        files.map(async (file) => ({
          path: file.path,
          text: await this.app.vault.read(file),
        })),
      );
      if (!this.isPreviewRequestCurrent(generation, active.path)) return;
      const result = await buildWorkflowPreview(
        {
          kind,
          targetPath: active.path,
          sources,
          settings: this.settings,
          resolveTarget: createObsidianLinkResolver(this.app.metadataCache),
        },
        {
          createId: createOperationId,
          now: () => new Date().toISOString(),
          hashText: sha256Text,
        },
      );
      if (!this.isPreviewRequestCurrent(generation, active.path)) return;
      if (result.kind === "no-op") {
        this.showNotice("notices.previewNoChanges");
        return;
      }
      this.currentPreview = result;
      const nonce = {};
      let modal: PersistedPreviewModal;
      modal = new PersistedPreviewModal(
        this.app,
        result,
        this.currentLocale(),
        () => this.confirmPreviewModal(result, nonce),
        () => {
          this.openModals.delete(modal);
          if (this.previewModal?.nonce === nonce) this.previewModal = null;
        },
      );
      this.previewModal = { planId: result.planId, modal, nonce };
      this.openModals.add(modal);
      modal.open();
      this.showNotice("notices.previewReady");
    } catch {
      if (this.isPreviewRequestCurrent(generation, active.path)) {
        this.showNotice("notices.operationError");
      }
    }
  }

  async applyCurrentPreview(): Promise<void> {
    if (this.settingsSaveInFlight > 0) {
      this.showNotice("notices.settingsSaving");
      return;
    }
    if (this.settings.mode !== "persisted") {
      this.showNotice("notices.persistedModeRequired");
      return;
    }
    const preview = this.currentPreview;
    if (!preview) {
      this.showNotice(
        this.previewWasInvalidated
          ? "notices.previewInvalidated"
          : "notices.previewRequired",
      );
      return;
    }
    await this.applyExactPreview(preview);
  }

  private confirmPreviewModal(
    preview: Extract<WorkflowPreviewResult, { kind: "preview" }>,
    nonce: object,
  ): void {
    const authority = this.previewModal;
    if (
      this.disposed ||
      !authority ||
      authority.nonce !== nonce ||
      authority.planId !== preview.planId ||
      this.currentPreview !== preview
    ) {
      return;
    }
    this.previewModal = null;
    void this.applyExactPreview(preview);
  }

  openSettings(): void {
    const candidate = (this.app as App & { readonly setting?: unknown })
      .setting;
    if (!isSettingsManager(candidate)) {
      this.showNotice("notices.openSettings");
      return;
    }
    try {
      candidate.open();
      candidate.openTabById(this.manifest.id);
    } catch {
      this.showNotice("notices.openSettings");
    }
  }

  async openRecoveryCenter(): Promise<void> {
    const operation = this.dataStore?.latestRecoveryOperation();
    const vault = this.vaultAdapter;
    const journal = this.dataStore?.journal;
    if (!operation || !vault || !journal) {
      this.showNotice("notices.recoveryNone");
      return;
    }
    const generation = this.lifecycleGeneration;
    await this.openRecoveryOperation(operation, generation, {
      vault,
      journal,
      hashText: sha256Text,
    });
  }

  private async openRecoveryOperation(
    operation: import("./persistence/types.js").PersistedOperation,
    generation: number,
    dependencies: import("./persistence/types.js").PersistenceDependencies,
  ): Promise<void> {
    const inspection = await inspectRecovery(operation, dependencies);
    if (this.disposed || generation !== this.lifecycleGeneration) return;
    const nonce = {};
    this.recoveryNonces.set(operation.id, nonce);
    let modal: RecoveryCenterModal;
    modal = new RecoveryCenterModal(
      this.app,
      inspection.files,
      this.currentLocale(),
      () => {
        this.beginRecovery(operation, generation, dependencies, nonce);
      },
      () => {
        this.openModals.delete(modal);
        if (this.recoveryNonces.get(operation.id) === nonce) {
          this.recoveryNonces.delete(operation.id);
        }
      },
    );
    this.openModals.add(modal);
    modal.open();
  }

  private beginRecovery(
    operation: import("./persistence/types.js").PersistedOperation,
    generation: number,
    dependencies: import("./persistence/types.js").PersistenceDependencies,
    nonce: object,
  ): void {
    if (
      this.disposed ||
      generation !== this.lifecycleGeneration ||
      this.recoveryNonces.get(operation.id) !== nonce ||
      this.recoveryInFlight.has(operation.id)
    ) {
      return;
    }
    this.recoveryNonces.delete(operation.id);
    const token = {};
    this.recoveryInFlight.set(operation.id, token);
    void this.restoreAndRefresh(operation, generation, dependencies, token);
  }

  private async restoreAndRefresh(
    operation: import("./persistence/types.js").PersistedOperation,
    generation: number,
    dependencies: import("./persistence/types.js").PersistenceDependencies,
    token: object,
  ): Promise<void> {
    let nextOperation:
      | import("./persistence/types.js").PersistedOperation
      | undefined;
    try {
      const result = await restoreEligibleFiles(operation, dependencies);
      if (this.disposed || generation !== this.lifecycleGeneration) return;
      this.showNotice(
        result.kind === "restored"
          ? "notices.restoreCompleted"
          : "notices.applyRecovery",
      );
      if (result.kind !== "restored") nextOperation = result.operation;
    } catch {
      if (!this.disposed && generation === this.lifecycleGeneration) {
        this.showNotice("notices.operationError");
      }
    } finally {
      if (this.recoveryInFlight.get(operation.id) === token) {
        this.recoveryInFlight.delete(operation.id);
      }
    }
    if (nextOperation && !this.disposed) {
      await this.openRecoveryOperation(nextOperation, generation, dependencies);
    }
  }

  currentLocale(): Locale {
    const systemLocale =
      typeof navigator === "undefined" ? "en" : navigator.language;
    return resolveLocale(this.settings.locale, systemLocale);
  }

  private async applyExactPreview(
    preview: Extract<WorkflowPreviewResult, { kind: "preview" }>,
  ): Promise<void> {
    if (this.settingsSaveInFlight > 0) {
      this.showNotice("notices.settingsSaving");
      return;
    }
    const active = this.app.workspace.getActiveFile();
    if (
      this.disposed ||
      this.settings.mode !== "persisted" ||
      this.currentPreview !== preview ||
      !(active instanceof TFile) ||
      active.path !== preview.targetPath ||
      !this.vaultAdapter ||
      !this.dataStore ||
      this.applyInFlight !== null
    ) {
      this.invalidatePersistedPreview();
      this.showNotice("notices.previewInvalidated");
      return;
    }
    this.currentPreview = null;
    this.previewGeneration += 1;
    this.previewWasInvalidated = false;
    const token = {};
    this.applyInFlight = { planId: preview.planId, token };
    if (this.previewModal?.planId === preview.planId) {
      const { modal } = this.previewModal;
      this.previewModal = null;
      modal.close();
    }
    let result: Awaited<ReturnType<typeof executePersistedOperation>>;
    try {
      result = await executePersistedOperation(preview.operation, {
        vault: this.vaultAdapter,
        journal: this.dataStore.journal,
        hashText: sha256Text,
      });
    } catch {
      if (!this.disposed) this.showNotice("notices.operationError");
      return;
    } finally {
      if (this.applyInFlight?.token === token) this.applyInFlight = null;
    }
    if (this.disposed) return;
    if (result.kind === "completed") {
      this.previewWasInvalidated = false;
      await this.refreshVirtualRendering();
      if (!this.disposed) this.showNotice("notices.applyCompleted");
    } else if (result.kind === "stale-plan") {
      this.previewWasInvalidated = true;
      this.showNotice("notices.applyStale");
    } else if (result.kind === "recovery-required") {
      this.previewWasInvalidated = true;
      this.showNotice("notices.applyRecovery");
    } else {
      this.previewWasInvalidated = true;
      this.showNotice("notices.operationError");
    }
  }

  private invalidatePersistedPreview(): void {
    if (this.currentPreview) this.previewWasInvalidated = true;
    this.currentPreview = null;
    this.previewGeneration += 1;
  }

  private isPreviewRequestCurrent(
    generation: number,
    targetPath: string,
  ): boolean {
    return (
      !this.disposed &&
      generation === this.previewGeneration &&
      this.settingsSaveInFlight === 0 &&
      this.settings.mode === "persisted" &&
      this.app.workspace.getActiveFile()?.path === targetPath
    );
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
      | "notices.refresh"
      | "notices.openSettings"
      | "notices.persistedModeRequired"
      | "notices.activeMarkdownRequired"
      | "notices.previewReady"
      | "notices.previewNoChanges"
      | "notices.previewRequired"
      | "notices.previewInvalidated"
      | "notices.applyCompleted"
      | "notices.applyStale"
      | "notices.applyRecovery"
      | "notices.operationError"
      | "notices.storageError"
      | "notices.settingsSaving"
      | "notices.recoveryAvailable"
      | "notices.recoveryNone"
      | "notices.restoreCompleted",
  ): void {
    new Notice(translate(this.currentLocale(), key));
  }
}

interface SettingsManagerCapability {
  open(): unknown;
  openTabById(id: string): unknown;
}

function isSettingsManager(value: unknown): value is SettingsManagerCapability {
  if (typeof value !== "object" || value === null) return false;
  try {
    const candidate = value as Partial<SettingsManagerCapability>;
    return (
      typeof candidate.open === "function" &&
      typeof candidate.openTabById === "function"
    );
  } catch {
    return false;
  }
}

function createOperationId(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export default HeadingNumberingPlugin;

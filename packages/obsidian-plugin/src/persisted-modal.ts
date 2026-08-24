import { Modal, type App } from "obsidian";
import type { RecoveryFileInspection } from "./persistence/types.js";
import type {
  PreviewGroups,
  WorkflowPreviewKind,
} from "./persisted-workflow.js";
import { translate, type Locale, type TranslationKey } from "./i18n.js";

export interface PreviewModalModel {
  readonly previewKind: WorkflowPreviewKind;
  readonly targetPath: string;
  readonly groups: PreviewGroups;
}

function heading(container: HTMLElement, text: string, count?: number): void {
  container.createEl("h3", {
    text: count === undefined ? text : `${text} (${count})`,
  });
}

function list(container: HTMLElement, items: readonly string[]): void {
  if (items.length === 0) return;
  const element = container.createEl("ul");
  for (const item of items) element.createEl("li", { text: item });
}

export class PersistedPreviewModal extends Modal {
  private consumed = false;

  constructor(
    app: App,
    private readonly model: PreviewModalModel,
    private readonly locale: Locale,
    private readonly confirm: () => void,
    private readonly onClosedCallback: () => void = () => undefined,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.setAttr(
      "aria-label",
      translate(this.locale, "modal.preview.aria"),
    );
    contentEl.createEl("h2", {
      text: `${translate(
        this.locale,
        this.model.previewKind === "add"
          ? "modal.preview.action.add"
          : "modal.preview.action.remove",
      )} — ${this.model.targetPath}`,
    });
    heading(
      contentEl,
      translate(this.locale, "modal.preview.target"),
      this.model.groups.targetEdits.length,
    );
    list(
      contentEl,
      this.model.groups.targetEdits.map((edit) =>
        this.editText(
          edit.range.from,
          edit.range.to,
          edit.expectedText,
          edit.replacementText,
        ),
      ),
    );
    heading(
      contentEl,
      translate(this.locale, "modal.preview.links"),
      this.model.groups.linkSources.length,
    );
    list(
      contentEl,
      this.model.groups.linkSources.flatMap((source) =>
        source.edits.map(
          (edit) =>
            `${source.path} ${this.editText(
              edit.range.from,
              edit.range.to,
              edit.expectedText,
              edit.replacementText,
            )}`,
        ),
      ),
    );
    heading(
      contentEl,
      translate(this.locale, "modal.preview.preserved"),
      this.model.groups.preserved.length,
    );
    list(
      contentEl,
      this.model.groups.preserved.map((item) => `${item.path}: ${item.code}`),
    );
    heading(
      contentEl,
      translate(this.locale, "modal.preview.skips"),
      this.model.groups.skips.length,
    );
    list(
      contentEl,
      this.model.groups.skips.map((item) => `${item.path}: ${item.code}`),
    );
    heading(contentEl, translate(this.locale, "modal.preview.boundary"));
    list(
      contentEl,
      this.model.groups.recoveryBoundary.map((code) =>
        translate(
          this.locale,
          code === "source-hash-preflight"
            ? "modal.preview.boundary.sourceHashPreflight"
            : "modal.preview.boundary.externalChangePreserved",
        ),
      ),
    );
    const button = contentEl.createEl("button", {
      text: translate(this.locale, "modal.preview.confirm"),
    });
    button.setAttr("type", "button");
    button.addEventListener("click", () => {
      if (this.consumed) return;
      this.consumed = true;
      button.disabled = true;
      this.close();
      this.confirm();
    });
  }

  onClose(): void {
    this.onClosedCallback();
  }

  private editText(
    from: number,
    to: number,
    expectedText: string,
    replacementText: string,
  ): string {
    const empty = translate(this.locale, "modal.preview.empty");
    return `${from}-${to}: ${expectedText || empty} → ${replacementText || empty}`;
  }
}

function recoveryStatusKey(
  status: RecoveryFileInspection["status"],
): TranslationKey {
  return `recovery.status.${status}`;
}

export class RecoveryCenterModal extends Modal {
  private consumed = false;

  constructor(
    app: App,
    private readonly files: readonly RecoveryFileInspection[],
    private readonly locale: Locale,
    private readonly restore: () => void,
    private readonly onClosedCallback: () => void = () => undefined,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.setAttr(
      "aria-label",
      translate(this.locale, "modal.recovery.aria"),
    );
    heading(contentEl, translate(this.locale, "modal.recovery.heading"));
    list(
      contentEl,
      this.files.map(
        (file) =>
          `${file.path}: ${translate(this.locale, recoveryStatusKey(file.status))}`,
      ),
    );
    const hasEligible = this.files.some((file) => file.status === "eligible");
    const canFinalize =
      !hasEligible &&
      this.files.length > 0 &&
      this.files.every(
        (file) => file.status === "pending" || file.status === "restored",
      );
    const button = contentEl.createEl("button", {
      text: translate(
        this.locale,
        hasEligible ? "modal.recovery.restore" : "modal.recovery.finalize",
      ),
    });
    button.setAttr("type", "button");
    button.disabled = !(hasEligible || canFinalize);
    button.addEventListener("click", () => {
      if (button.disabled || this.consumed) return;
      this.consumed = true;
      button.disabled = true;
      this.restore();
      this.close();
    });
  }

  onClose(): void {
    this.onClosedCallback();
  }
}

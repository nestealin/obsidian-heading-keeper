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
  constructor(
    app: App,
    private readonly model: PreviewModalModel,
    private readonly locale: Locale,
    private readonly confirm: () => void,
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
    heading(
      contentEl,
      translate(this.locale, "modal.preview.target"),
      this.model.groups.targetEdits.length,
    );
    list(
      contentEl,
      this.model.groups.targetEdits.map(
        (edit) => `${edit.range.from}-${edit.range.to}`,
      ),
    );
    heading(
      contentEl,
      translate(this.locale, "modal.preview.links"),
      this.model.groups.linkSources.length,
    );
    list(
      contentEl,
      this.model.groups.linkSources.map(
        (source) => `${source.path}: ${source.edits}`,
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
    list(contentEl, this.model.groups.recoveryBoundary);
    const button = contentEl.createEl("button", {
      text: translate(this.locale, "modal.preview.confirm"),
    });
    button.setAttr("type", "button");
    button.addEventListener("click", () => this.confirm());
  }
}

function recoveryStatusKey(
  status: RecoveryFileInspection["status"],
): TranslationKey {
  return `recovery.status.${status}`;
}

export class RecoveryCenterModal extends Modal {
  constructor(
    app: App,
    private readonly files: readonly RecoveryFileInspection[],
    private readonly locale: Locale,
    private readonly restore: () => void,
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
    const button = contentEl.createEl("button", {
      text: translate(this.locale, "modal.recovery.restore"),
    });
    button.setAttr("type", "button");
    button.disabled = !this.files.some((file) => file.status === "eligible");
    button.addEventListener("click", () => {
      if (!button.disabled) this.restore();
    });
  }
}

import { Modal, type App } from "obsidian";
import type { RecoveryFileInspection } from "./persistence/types.js";
import type {
  PreviewGroups,
  PreviewReasonCode,
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

const REASON_TRANSLATION_KEYS = {
  "missing-heading-fragment": "modal.preview.reason.missing-heading-fragment",
  "external-link": "modal.preview.reason.external-link",
  "malformed-percent-encoding":
    "modal.preview.reason.malformed-percent-encoding",
  "block-reference": "modal.preview.reason.block-reference",
  "target-resolution-error": "modal.preview.reason.target-resolution-error",
  "target-missing": "modal.preview.reason.target-missing",
  "target-ambiguous": "modal.preview.reason.target-ambiguous",
  "target-external": "modal.preview.reason.target-external",
  "target-path-invalid": "modal.preview.reason.target-path-invalid",
  "duplicate-heading-rename": "modal.preview.reason.duplicate-heading-rename",
  "ambiguous-prefix": "modal.preview.reason.ambiguous-prefix",
  "semantic-prefix": "modal.preview.reason.semantic-prefix",
  "missing-parent": "modal.preview.reason.missing-parent",
  "heading-outside-range": "modal.preview.reason.heading-outside-range",
  "heading-missing-top-level": "modal.preview.reason.heading-missing-top-level",
  "heading-not-numbered": "modal.preview.reason.heading-not-numbered",
} satisfies Record<PreviewReasonCode, TranslationKey>;

function reasonText(locale: Locale, code: string): string {
  const label = locale === "zh" ? "原因" : "Reason";
  const separator = locale === "zh" ? "：" : ": ";
  const key = Object.prototype.hasOwnProperty.call(
    REASON_TRANSLATION_KEYS,
    code,
  )
    ? REASON_TRANSLATION_KEYS[code as PreviewReasonCode]
    : undefined;
  return key
    ? `${label}${separator}${translate(locale, key)} [${code}]`
    : `${label}${separator}${code}`;
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
      this.model.groups.linkSources.reduce(
        (count, source) => count + source.edits.length,
        0,
      ),
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
      this.model.groups.preserved.map(
        (item) => `${item.path}: ${reasonText(this.locale, item.code)}`,
      ),
    );
    heading(
      contentEl,
      translate(this.locale, "modal.preview.skips"),
      this.model.groups.skips.length,
    );
    list(
      contentEl,
      this.model.groups.skips.map(
        (item) => `${item.path}: ${reasonText(this.locale, item.code)}`,
      ),
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
      this.confirm();
      this.close();
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

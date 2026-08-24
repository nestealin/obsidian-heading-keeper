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

const REASON_DESCRIPTIONS: Record<Locale, Readonly<Record<string, string>>> = {
  en: {
    "ambiguous-prefix": "Ambiguous numbering prefix",
    "block-reference": "Block reference",
    "duplicate-heading-rename": "Duplicate heading rename",
    "external-link": "External link",
    "heading-missing-top-level": "Missing top-level heading",
    "heading-not-numbered": "Heading is not numbered",
    "heading-outside-range": "Heading outside configured range",
    "malformed-percent-encoding": "Malformed fragment encoding",
    "missing-parent": "Missing parent heading",
    "semantic-prefix": "Semantically similar numbering prefix",
    "target-ambiguous": "Ambiguous target",
    "target-external": "External target",
    "target-missing": "Missing target",
    "target-path-invalid": "Invalid target path",
    "target-resolution-error": "Target resolution failed",
  },
  zh: {
    "ambiguous-prefix": "编号前缀归属不明确",
    "block-reference": "块引用",
    "duplicate-heading-rename": "重复的标题重命名",
    "external-link": "外部链接",
    "heading-missing-top-level": "缺少起始层级标题",
    "heading-not-numbered": "标题未编号",
    "heading-outside-range": "标题超出配置层级",
    "malformed-percent-encoding": "片段编码格式错误",
    "missing-parent": "缺少父级标题",
    "semantic-prefix": "语义相似的编号前缀",
    "target-ambiguous": "目标不明确",
    "target-external": "外部目标",
    "target-missing": "目标不存在",
    "target-path-invalid": "目标路径无效",
    "target-resolution-error": "目标解析失败",
  },
};

function reasonText(locale: Locale, code: string): string {
  const label = locale === "zh" ? "原因" : "Reason";
  const separator = locale === "zh" ? "：" : ": ";
  const description = REASON_DESCRIPTIONS[locale][code];
  return description
    ? `${label}${separator}${description} [${code}]`
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

import { Modal, type App } from "obsidian";
import type { HeadingLinkAuditResult } from "@heading-keeper/link-core";
import { translate, type Locale } from "./i18n.js";

export class HeadingLinkAuditModal extends Modal {
  constructor(
    app: App,
    private readonly result: HeadingLinkAuditResult,
    private readonly locale: Locale,
    private readonly closed: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.setAttr("role", "dialog");
    this.contentEl.setAttr(
      "aria-label",
      translate(this.locale, "modal.audit.aria"),
    );
    this.contentEl.createEl("h2", {
      text: translate(this.locale, "modal.audit.heading"),
    });
    this.contentEl.createEl("p", {
      text:
        this.locale === "zh"
          ? `已扫描 ${this.result.scannedLinks} 个标题链接；发现 ${this.result.brokenCount} 个问题；跳过 ${this.result.skippedCount} 个受保护链接。`
          : `${this.result.scannedLinks} heading links scanned; ${this.result.brokenCount} issues; ${this.result.skippedCount} protected links skipped.`,
    });
    if (this.result.findings.length === 0) {
      this.contentEl.createEl("p", {
        text: translate(this.locale, "modal.audit.noFindings"),
      });
      return;
    }
    const list = this.contentEl.createEl("ul");
    for (const item of this.result.findings) {
      list.createEl("li", {
        text: `${item.sourcePath}: ${item.code} (${item.fragment})`,
      });
    }
  }

  onClose(): void {
    this.closed();
  }
}

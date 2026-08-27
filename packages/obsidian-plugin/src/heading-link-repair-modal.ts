import { Modal, type App } from "obsidian";
import type {
  HeadingLinkAuditFinding,
  HeadingLinkAuditResult,
  HeadingLinkRepairSelection,
} from "@heading-keeper/link-core";
import type { Locale } from "./i18n.js";

export interface HeadingLinkRepairActions {
  readonly confirm: (selections: readonly HeadingLinkRepairSelection[]) => void;
  readonly navigate: (sourcePath: string, line: number) => void;
  readonly exported: (json: string) => void;
  readonly closed: () => void;
}

export class HeadingLinkRepairModal extends Modal {
  private readonly selections = new Map<string, HeadingLinkRepairSelection>();
  private confirmButton: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private readonly result: HeadingLinkAuditResult,
    private readonly locale: Locale,
    private readonly actions: HeadingLinkRepairActions,
  ) {
    super(app);
  }

  filteredFindings(query: string): readonly HeadingLinkAuditFinding[] {
    const normalized = query.trim().toLocaleLowerCase();
    return this.result.findings.filter((finding) => {
      if (finding.repairEligibility !== "selection-required") return false;
      if (normalized.length === 0) return true;
      return [finding.sourcePath, finding.code, finding.fragment]
        .join("\n")
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }

  select(findingId: string, targetPath: string, heading: string): boolean {
    const finding = this.result.findings.find((item) => item.id === findingId);
    const candidate = finding?.candidates.find(
      (item) => item.targetPath === targetPath,
    );
    if (
      finding?.repairEligibility !== "selection-required" ||
      !candidate?.headings.includes(heading)
    ) {
      return false;
    }
    this.selections.set(findingId, { findingId, targetPath, heading });
    this.updateConfirmButton();
    return true;
  }

  navigateTo(findingId: string): boolean {
    const finding = this.result.findings.find((item) => item.id === findingId);
    if (!finding) return false;
    this.actions.navigate(finding.sourcePath, finding.line);
    return true;
  }

  exportReport(): string {
    const json = JSON.stringify(
      {
        schemaVersion: 1,
        scannedLinks: this.result.scannedLinks,
        brokenCount: this.result.brokenCount,
        skippedCount: this.result.skippedCount,
        findings: this.result.findings,
      },
      null,
      2,
    );
    this.actions.exported(json);
    return json;
  }

  confirmSelected(): boolean {
    const selections = [...this.selections.values()].sort((left, right) =>
      left.findingId < right.findingId
        ? -1
        : left.findingId > right.findingId
          ? 1
          : 0,
    );
    if (selections.length === 0) return false;
    this.actions.confirm(selections);
    return true;
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.setAttr("role", "dialog");
    this.contentEl.setAttr(
      "aria-label",
      this.locale === "zh" ? "修复标题断链" : "Repair broken heading links",
    );
    this.contentEl.createEl("h2", {
      text: this.locale === "zh" ? "修复标题断链" : "Repair heading links",
    });
    const filter = this.contentEl.createEl("input", {
      type: "search",
      placeholder: this.locale === "zh" ? "筛选问题" : "Filter findings",
    });
    const list = this.contentEl.createEl("div");
    const render = () => this.renderFindings(list, filter.value);
    filter.addEventListener("input", render);
    render();

    const exportButton = this.contentEl.createEl("button", {
      text: this.locale === "zh" ? "导出问题 JSON" : "Export findings JSON",
    });
    exportButton.addEventListener("click", () => this.exportReport());
    this.confirmButton = this.contentEl.createEl("button", {
      text:
        this.locale === "zh" ? "确认修复所选项" : "Confirm selected repairs",
    });
    this.confirmButton.addEventListener("click", () => {
      if (this.confirmSelected()) this.close();
    });
    this.updateConfirmButton();
  }

  onClose(): void {
    this.actions.closed();
  }

  private renderFindings(root: HTMLElement, query: string): void {
    root.empty();
    for (const finding of this.filteredFindings(query)) {
      const row = root.createEl("div");
      row.createEl("span", {
        text: `${finding.sourcePath}:${finding.line} ${finding.fragment}`,
      });
      const navigate = row.createEl("button", {
        text: this.locale === "zh" ? "打开" : "Open",
      });
      navigate.addEventListener("click", () => this.navigateTo(finding.id));
      const select = row.createEl("select");
      select.createEl("option", {
        text: this.locale === "zh" ? "选择正确标题" : "Choose target heading",
        value: "",
      });
      for (const candidate of finding.candidates) {
        for (const heading of candidate.headings) {
          const value = JSON.stringify([candidate.targetPath, heading]);
          select.createEl("option", {
            text: `${candidate.targetPath}#${heading}`,
            value,
          });
        }
      }
      select.addEventListener("change", () => {
        if (select.value.length === 0) {
          this.selections.delete(finding.id);
          this.updateConfirmButton();
          return;
        }
        const [targetPath, heading] = JSON.parse(select.value) as [
          string,
          string,
        ];
        this.select(finding.id, targetPath, heading);
      });
    }
  }

  private updateConfirmButton(): void {
    if (this.confirmButton)
      this.confirmButton.disabled = this.selections.size === 0;
  }
}

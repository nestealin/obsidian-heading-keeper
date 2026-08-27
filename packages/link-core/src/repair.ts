import { scanHeadings, type SourceRange } from "@heading-keeper/core";
import type {
  HeadingLinkAuditFinding,
  HeadingLinkAuditSource,
} from "./audit.js";
import { scanHeadingLinks } from "./tokenizer.js";
import type { LinkToken } from "./types.js";

export interface HeadingLinkRepairSelection {
  readonly findingId: string;
  readonly targetPath: string;
  readonly heading: string;
}

export interface HeadingLinkRepairInput {
  readonly sources: readonly HeadingLinkAuditSource[];
  readonly findings: readonly HeadingLinkAuditFinding[];
  readonly selections: readonly HeadingLinkRepairSelection[];
}

export type HeadingLinkRepairDiagnosticCode =
  | "finding-missing"
  | "selection-duplicate"
  | "selection-not-allowed"
  | "selection-invalid"
  | "source-unavailable"
  | "source-stale"
  | "edit-overlap";

export interface HeadingLinkRepairDiagnostic {
  readonly findingId: string;
  readonly code: HeadingLinkRepairDiagnosticCode;
}

export interface HeadingLinkRepairEdit {
  readonly sourcePath: string;
  readonly range: SourceRange;
  readonly expectedText: string;
  readonly replacementText: string;
  readonly targetPath: string;
  readonly heading: string;
}

export type HeadingLinkRepairPlan =
  | { readonly kind: "plan"; readonly edits: readonly HeadingLinkRepairEdit[] }
  | {
      readonly kind: "invalid";
      readonly diagnostics: readonly HeadingLinkRepairDiagnostic[];
    };

export function buildRepairPlan(
  input: HeadingLinkRepairInput,
): HeadingLinkRepairPlan {
  const sources = new Map(
    input.sources.map((source) => [source.path, source.text]),
  );
  const findings = new Map(
    input.findings.map((finding) => [finding.id, finding]),
  );
  const seen = new Set<string>();
  const diagnostics: HeadingLinkRepairDiagnostic[] = [];
  const edits: HeadingLinkRepairEdit[] = [];

  for (const selection of input.selections) {
    if (seen.has(selection.findingId)) {
      diagnostics.push({
        findingId: selection.findingId,
        code: "selection-duplicate",
      });
      continue;
    }
    seen.add(selection.findingId);
    const finding = findings.get(selection.findingId);
    if (!finding) {
      diagnostics.push({
        findingId: selection.findingId,
        code: "finding-missing",
      });
      continue;
    }
    if (finding.repairEligibility !== "selection-required") {
      diagnostics.push({
        findingId: selection.findingId,
        code: "selection-not-allowed",
      });
      continue;
    }
    const candidate = finding.candidates.find(
      (item) => item.targetPath === selection.targetPath,
    );
    const targetSource = sources.get(selection.targetPath);
    const currentHeadings =
      targetSource === undefined
        ? []
        : scanHeadings(targetSource).map((heading) =>
            heading.semanticText.normalize("NFC"),
          );
    if (
      !candidate?.headings.includes(selection.heading) ||
      !currentHeadings.includes(selection.heading.normalize("NFC"))
    ) {
      diagnostics.push({
        findingId: selection.findingId,
        code: "selection-invalid",
      });
      continue;
    }
    const source = sources.get(finding.sourcePath);
    if (source === undefined) {
      diagnostics.push({
        findingId: selection.findingId,
        code: "source-unavailable",
      });
      continue;
    }
    if (
      source.slice(finding.sourceRange.from, finding.sourceRange.to) !==
      finding.rawTarget
    ) {
      diagnostics.push({
        findingId: selection.findingId,
        code: "source-stale",
      });
      continue;
    }
    const token = scanHeadingLinks(source).find(
      (item) =>
        item.range.from === finding.sourceRange.from &&
        item.range.to === finding.sourceRange.to &&
        item.raw === finding.rawTarget,
    );
    if (!token || !token.fragmentRange) {
      diagnostics.push({
        findingId: selection.findingId,
        code: "source-stale",
      });
      continue;
    }
    edits.push({
      sourcePath: finding.sourcePath,
      range: token.range,
      expectedText: token.raw,
      replacementText: replacement(token, finding, selection),
      targetPath: selection.targetPath,
      heading: selection.heading,
    });
  }

  const sorted = edits.sort(
    (left, right) =>
      compareCodeUnits(left.sourcePath, right.sourcePath) ||
      left.range.from - right.range.from,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (
      previous.sourcePath === current.sourcePath &&
      previous.range.to > current.range.from
    ) {
      diagnostics.push({
        findingId: `${current.sourcePath}:${current.range.from}:${current.range.to}`,
        code: "edit-overlap",
      });
    }
  }

  return diagnostics.length > 0
    ? { kind: "invalid", diagnostics }
    : { kind: "plan", edits: sorted };
}

function replacement(
  token: LinkToken,
  finding: HeadingLinkAuditFinding,
  selection: HeadingLinkRepairSelection,
): string {
  const fragment =
    token.kind === "wiki" || token.kind === "embed"
      ? encodeWikiHeading(selection.heading)
      : encodeURIComponent(selection.heading.normalize("NFC"));
  if (finding.targetPath === selection.targetPath && token.fragmentRange) {
    const from = token.fragmentRange.from - token.range.from;
    const to = token.fragmentRange.to - token.range.from;
    return token.raw.slice(0, from) + fragment + token.raw.slice(to);
  }

  if (token.kind === "wiki" || token.kind === "embed") {
    const opener = token.kind === "embed" ? "![[" : "[[";
    const target = vaultLinkPath(selection.targetPath, finding.sourcePath);
    return `${opener}${target}#${fragment}${token.alias === null ? "" : `|${token.alias}`}]]`;
  }
  const opener = token.kind === "image" ? "![" : "[";
  const target = encodeURI(selection.targetPath.normalize("NFC"));
  const destination = `${target}#${fragment}`;
  const renderedDestination = token.angleDestination
    ? `<${destination}>`
    : destination;
  return `${opener}${token.label ?? ""}](${renderedDestination}${token.title ? ` ${token.title}` : ""})`;
}

function vaultLinkPath(targetPath: string, sourcePath: string): string {
  if (targetPath === sourcePath) return "";
  return targetPath.endsWith(".md") ? targetPath.slice(0, -3) : targetPath;
}

function encodeWikiHeading(heading: string): string {
  let encoded = "";
  for (const character of heading.normalize("NFC")) {
    if (character === "%") encoded += "%25";
    else if (character === "|") encoded += "%7C";
    else if (character === "]") encoded += "%5D";
    else encoded += character;
  }
  return encoded;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

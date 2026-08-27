import { scanHeadings, type SourceRange } from "@heading-keeper/core";
import { normalizeHeadingFragment } from "./fragments.js";
import { scanHeadingLinks } from "./tokenizer.js";
import type { ResolvedTarget } from "./types.js";

export type HeadingLinkAuditCode =
  | "malformed-percent-encoding"
  | "block-reference"
  | "target-resolution-error"
  | "target-missing"
  | "target-ambiguous"
  | "target-external"
  | "target-path-invalid"
  | "target-source-unavailable"
  | "heading-missing"
  | "heading-duplicate";

export interface HeadingLinkAuditSource {
  readonly path: string;
  readonly text: string;
}

export interface HeadingLinkAuditFinding {
  readonly id: string;
  readonly sourcePath: string;
  readonly code: HeadingLinkAuditCode;
  readonly fragment: string;
  readonly rawTarget: string;
  readonly line: number;
  readonly sourceRange: SourceRange;
  readonly targetPath?: string;
  readonly candidates: readonly HeadingLinkRepairCandidate[];
  readonly repairEligibility: "selection-required" | "not-repairable";
}

export interface HeadingLinkRepairCandidate {
  readonly targetPath: string;
  readonly headings: readonly string[];
}

export interface HeadingLinkAuditInput {
  readonly sources: readonly HeadingLinkAuditSource[];
  readonly resolveTarget: (
    sourcePath: string,
    linkPath: string,
  ) => ResolvedTarget;
}

export interface HeadingLinkAuditResult {
  readonly scannedLinks: number;
  readonly brokenCount: number;
  readonly skippedCount: number;
  readonly findings: readonly HeadingLinkAuditFinding[];
}

function isExternalLinkPath(linkPath: string): boolean {
  return (
    linkPath.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(linkPath)
  );
}

function normalizeTargetPath(path: string): string | null {
  const unified = path.replaceAll("\\", "/");
  if (
    unified.length === 0 ||
    unified.startsWith("/") ||
    /^[A-Za-z]:\//.test(unified)
  ) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of unified.split("/")) {
    if (segment === "") return null;
    if (segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment.normalize("NFC"));
    }
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function finding(
  sourcePath: string,
  code: HeadingLinkAuditCode,
  fragment: string,
  sourceRange: SourceRange,
  rawTarget: string,
  line: number,
  targetPath?: string,
  candidates: readonly HeadingLinkRepairCandidate[] = [],
): HeadingLinkAuditFinding {
  const base = {
    id: `${sourcePath}:${sourceRange.from}:${sourceRange.to}`,
    sourcePath,
    code,
    fragment,
    rawTarget,
    line,
    sourceRange,
    candidates,
    repairEligibility: candidates.some(
      (candidate) => candidate.headings.length > 0,
    )
      ? ("selection-required" as const)
      : ("not-repairable" as const),
  };
  return targetPath === undefined ? base : { ...base, targetPath };
}

export function auditHeadingLinks(
  input: HeadingLinkAuditInput,
): HeadingLinkAuditResult {
  const sources = [...input.sources].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const headingsByPath = new Map<
    string,
    {
      readonly counts: ReadonlyMap<string, number>;
      readonly headings: string[];
    }
  >();
  for (const source of sources) {
    const path = normalizeTargetPath(source.path);
    if (path === null) continue;
    const counts = new Map<string, number>();
    for (const heading of scanHeadings(source.text)) {
      const identity = heading.semanticText.normalize("NFC");
      counts.set(identity, (counts.get(identity) ?? 0) + 1);
    }
    headingsByPath.set(path, {
      counts,
      headings: [...counts.keys()].sort(compareCodeUnits),
    });
  }

  const findings: HeadingLinkAuditFinding[] = [];
  let scannedLinks = 0;
  for (const source of sources) {
    for (const token of scanHeadingLinks(source.text)) {
      if (
        token.rawFragment === null ||
        token.fragmentRange === null ||
        isExternalLinkPath(token.linkPath)
      ) {
        continue;
      }
      scannedLinks += 1;
      const line = source.text.slice(0, token.range.from).split("\n").length;
      const normalizedFragment = normalizeHeadingFragment(token.rawFragment);
      if (!normalizedFragment.ok) {
        findings.push(
          finding(
            source.path,
            normalizedFragment.code,
            token.rawFragment,
            token.range,
            token.raw,
            line,
          ),
        );
        continue;
      }
      const fragment = normalizedFragment.value;
      if (fragment.startsWith("^")) {
        findings.push(
          finding(
            source.path,
            "block-reference",
            fragment,
            token.range,
            token.raw,
            line,
          ),
        );
        continue;
      }

      let resolved: ResolvedTarget;
      try {
        resolved = input.resolveTarget(source.path, token.linkPath);
      } catch {
        findings.push(
          finding(
            source.path,
            "target-resolution-error",
            fragment,
            token.range,
            token.raw,
            line,
          ),
        );
        continue;
      }
      if (resolved.kind !== "file") {
        const code =
          resolved.kind === "missing"
            ? "target-missing"
            : resolved.kind === "ambiguous"
              ? "target-ambiguous"
              : "target-external";
        const candidates =
          resolved.kind === "ambiguous"
            ? resolved.paths.flatMap((candidatePath) => {
                const normalized = normalizeTargetPath(candidatePath);
                const indexed = normalized
                  ? headingsByPath.get(normalized)
                  : undefined;
                return normalized && indexed
                  ? [{ targetPath: normalized, headings: indexed.headings }]
                  : [];
              })
            : [];
        findings.push(
          finding(
            source.path,
            code,
            fragment,
            token.range,
            token.raw,
            line,
            undefined,
            candidates,
          ),
        );
        continue;
      }
      const targetPath = normalizeTargetPath(resolved.path);
      if (targetPath === null) {
        findings.push(
          finding(
            source.path,
            "target-path-invalid",
            fragment,
            token.range,
            token.raw,
            line,
          ),
        );
        continue;
      }
      const targetHeadings = headingsByPath.get(targetPath);
      if (!targetHeadings) {
        findings.push(
          finding(
            source.path,
            "target-source-unavailable",
            fragment,
            token.range,
            token.raw,
            line,
            targetPath,
          ),
        );
        continue;
      }
      const count = targetHeadings.counts.get(fragment) ?? 0;
      if (count === 0) {
        findings.push(
          finding(
            source.path,
            "heading-missing",
            fragment,
            token.range,
            token.raw,
            line,
            targetPath,
            [{ targetPath, headings: targetHeadings.headings }],
          ),
        );
      } else if (count > 1) {
        findings.push(
          finding(
            source.path,
            "heading-duplicate",
            fragment,
            token.range,
            token.raw,
            line,
            targetPath,
          ),
        );
      }
    }
  }

  const skippedCount = findings.filter(
    (item) =>
      item.code === "block-reference" || item.code === "target-external",
  ).length;
  return {
    scannedLinks,
    brokenCount: findings.length - skippedCount,
    skippedCount,
    findings,
  };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

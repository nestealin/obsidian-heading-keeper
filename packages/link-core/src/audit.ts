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
  readonly sourcePath: string;
  readonly code: HeadingLinkAuditCode;
  readonly fragment: string;
  readonly sourceRange: SourceRange;
  readonly targetPath?: string;
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
  targetPath?: string,
): HeadingLinkAuditFinding {
  return targetPath === undefined
    ? { sourcePath, code, fragment, sourceRange }
    : { sourcePath, code, fragment, sourceRange, targetPath };
}

export function auditHeadingLinks(
  input: HeadingLinkAuditInput,
): HeadingLinkAuditResult {
  const sources = [...input.sources].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const headingsByPath = new Map<string, ReadonlyMap<string, number>>();
  for (const source of sources) {
    const path = normalizeTargetPath(source.path);
    if (path === null) continue;
    const counts = new Map<string, number>();
    for (const heading of scanHeadings(source.text)) {
      const identity = heading.semanticText.normalize("NFC");
      counts.set(identity, (counts.get(identity) ?? 0) + 1);
    }
    headingsByPath.set(path, counts);
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
      const normalizedFragment = normalizeHeadingFragment(token.rawFragment);
      if (!normalizedFragment.ok) {
        findings.push(
          finding(
            source.path,
            normalizedFragment.code,
            token.rawFragment,
            token.range,
          ),
        );
        continue;
      }
      const fragment = normalizedFragment.value;
      if (fragment.startsWith("^")) {
        findings.push(
          finding(source.path, "block-reference", fragment, token.range),
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
        findings.push(finding(source.path, code, fragment, token.range));
        continue;
      }
      const targetPath = normalizeTargetPath(resolved.path);
      if (targetPath === null) {
        findings.push(
          finding(source.path, "target-path-invalid", fragment, token.range),
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
            targetPath,
          ),
        );
        continue;
      }
      const count = targetHeadings.get(fragment) ?? 0;
      if (count === 0) {
        findings.push(
          finding(
            source.path,
            "heading-missing",
            fragment,
            token.range,
            targetPath,
          ),
        );
      } else if (count > 1) {
        findings.push(
          finding(
            source.path,
            "heading-duplicate",
            fragment,
            token.range,
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

import { normalizeHeadingFragment } from "./fragments.js";
import { scanHeadingLinks } from "./tokenizer.js";
import type {
  HeadingRename,
  LinkDiagnostic,
  LinkDiagnosticCode,
  LinkEdit,
  LinkPlan,
  LinkToken,
  PlanHeadingLinkChangesInput,
  ResolvedTarget,
} from "./types.js";

function normalizeTargetPath(path: string): string | null {
  const unifiedPath = path.replaceAll("\\", "/");
  if (
    unifiedPath.length === 0 ||
    unifiedPath.startsWith("/") ||
    /^[A-Za-z]:\//.test(unifiedPath)
  ) {
    return null;
  }

  const normalizedSegments: string[] = [];
  for (const segment of unifiedPath.split("/")) {
    if (segment === "") return null;
    if (segment === ".") continue;
    if (segment === "..") {
      if (normalizedSegments.length === 0) return null;
      normalizedSegments.pop();
      continue;
    }
    normalizedSegments.push(segment.normalize("NFC"));
  }
  return normalizedSegments.length === 0 ? null : normalizedSegments.join("/");
}

function identity(rename: HeadingRename): string | null {
  const targetPath = normalizeTargetPath(rename.targetPath);
  if (targetPath === null) return null;
  const heading = normalizeHeadingFragment(rename.oldHeading);
  return heading.ok ? `${targetPath}\u0000${heading.value}` : null;
}

function diagnostic(
  token: LinkToken,
  code: LinkDiagnosticCode,
  message: string,
): LinkDiagnostic {
  return { code, message, sourceRange: token.range };
}

function isExternalLinkPath(linkPath: string): boolean {
  return (
    linkPath.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(linkPath)
  );
}

function encodeWikiHeadingFragment(heading: string): string {
  let encoded = "";
  for (const character of heading.normalize("NFC")) {
    if (character === "%") encoded += "%25";
    else if (character === "|") encoded += "%7C";
    else if (character === "]") encoded += "%5D";
    else encoded += character;
  }
  return encoded;
}

function renamesByIdentity(
  renames: readonly HeadingRename[],
): Map<string, HeadingRename[]> {
  const result = new Map<string, HeadingRename[]>();
  for (const rename of renames) {
    const key = identity(rename);
    if (key === null) continue;
    const matches = result.get(key);
    if (matches) {
      matches.push(rename);
    } else {
      result.set(key, [rename]);
    }
  }
  return result;
}

function normalizedRenameHeadings(
  renames: readonly HeadingRename[],
): ReadonlySet<string> {
  const headings = new Set<string>();
  for (const rename of renames) {
    const heading = normalizeHeadingFragment(rename.oldHeading);
    if (heading.ok) headings.add(heading.value);
  }
  return headings;
}

function normalizedRenameTargets(
  renames: readonly HeadingRename[],
): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const rename of renames) {
    const target = normalizeTargetPath(rename.targetPath);
    if (target !== null) targets.add(target);
  }
  return targets;
}

function appendRenameCandidateDiagnostic(
  diagnostics: LinkDiagnostic[],
  token: LinkToken,
  target: ResolvedTarget,
): string | null {
  if (target.kind === "missing") {
    diagnostics.push(
      diagnostic(token, "target-missing", "Link target could not be resolved."),
    );
    return null;
  }
  if (target.kind === "ambiguous") {
    diagnostics.push(
      diagnostic(
        token,
        "target-ambiguous",
        "Link target resolved to more than one file.",
      ),
    );
    return null;
  }
  if (target.kind === "external") {
    return null;
  }
  const targetPath = normalizeTargetPath(target.path);
  if (targetPath === null) {
    return null;
  }
  return targetPath;
}

export function planHeadingLinkChanges({
  sourcePath,
  markdown,
  renames,
  resolveTarget,
}: PlanHeadingLinkChangesInput): LinkPlan {
  const renameMap = renamesByIdentity(renames);

  const edits: LinkEdit[] = [];
  const diagnostics: LinkDiagnostic[] = [];
  for (const token of scanHeadingLinks(markdown)) {
    if (token.rawFragment === null || token.fragmentRange === null) {
      diagnostics.push(
        diagnostic(
          token,
          "missing-heading-fragment",
          "Link has no heading fragment and was preserved.",
        ),
      );
      continue;
    }
    if (isExternalLinkPath(token.linkPath)) {
      diagnostics.push(
        diagnostic(
          token,
          "external-link",
          "External links are not resolved as vault files.",
        ),
      );
      continue;
    }
    const fragment = normalizeHeadingFragment(token.rawFragment);
    if (!fragment.ok) {
      diagnostics.push(
        diagnostic(
          token,
          fragment.code,
          "Heading fragment contains malformed percent encoding.",
        ),
      );
      continue;
    }
    if (fragment.value.startsWith("^")) {
      diagnostics.push(
        diagnostic(
          token,
          "block-reference",
          "Block references are not heading rename targets.",
        ),
      );
      continue;
    }
    let target: ResolvedTarget;
    try {
      target = resolveTarget(sourcePath, token.linkPath);
    } catch {
      diagnostics.push(
        diagnostic(
          token,
          "target-resolution-error",
          "Target resolution failed.",
        ),
      );
      continue;
    }
    if (target.kind === "missing") {
      diagnostics.push(
        diagnostic(
          token,
          "target-missing",
          "Link target could not be resolved.",
        ),
      );
      continue;
    }
    if (target.kind === "ambiguous") {
      diagnostics.push(
        diagnostic(
          token,
          "target-ambiguous",
          "Link target resolved to more than one file.",
        ),
      );
      continue;
    }
    if (target.kind === "external") {
      diagnostics.push(
        diagnostic(
          token,
          "target-external",
          "Resolver classified the target as external.",
        ),
      );
      continue;
    }
    const targetPath = normalizeTargetPath(target.path);
    if (targetPath === null) {
      diagnostics.push(
        diagnostic(
          token,
          "target-path-invalid",
          "Resolver returned a path outside the vault-relative identity domain.",
        ),
      );
      continue;
    }
    const matches = renameMap.get(`${targetPath}\u0000${fragment.value}`);
    if (!matches) continue;
    if (matches.length !== 1) {
      diagnostics.push(
        diagnostic(
          token,
          "duplicate-heading-rename",
          "Multiple renames share the same normalized file and heading identity.",
        ),
      );
      continue;
    }
    const rename = matches[0];
    if (!rename) continue;
    const localFrom = token.fragmentRange.from - token.range.from;
    const localTo = token.fragmentRange.to - token.range.from;
    const newFragment =
      token.kind === "wiki" || token.kind === "embed"
        ? encodeWikiHeadingFragment(rename.newHeading)
        : encodeURIComponent(rename.newHeading.normalize("NFC"));
    edits.push({
      range: token.range,
      replacement:
        token.raw.slice(0, localFrom) + newFragment + token.raw.slice(localTo),
      targetPath,
      reason: "unique-heading-rename",
    });
  }

  edits.sort((left, right) => left.range.from - right.range.from);
  diagnostics.sort(
    (left, right) => left.sourceRange.from - right.sourceRange.from,
  );
  return { edits, diagnostics };
}

export function planRenameScopedLinkChanges({
  sourcePath,
  markdown,
  renames,
  resolveTarget,
}: PlanHeadingLinkChangesInput): LinkPlan {
  const renameMap = renamesByIdentity(renames);
  const renameHeadings = normalizedRenameHeadings(renames);
  const renameTargets = normalizedRenameTargets(renames);
  const edits: LinkEdit[] = [];
  const diagnostics: LinkDiagnostic[] = [];

  for (const token of scanHeadingLinks(markdown)) {
    if (token.rawFragment === null || token.fragmentRange === null) continue;
    if (isExternalLinkPath(token.linkPath)) continue;

    const fragment = normalizeHeadingFragment(token.rawFragment);
    if (!fragment.ok) {
      let target: ResolvedTarget;
      try {
        target = resolveTarget(sourcePath, token.linkPath);
      } catch {
        continue;
      }
      if (target.kind !== "file") continue;
      const targetPath = normalizeTargetPath(target.path);
      if (targetPath === null || !renameTargets.has(targetPath)) continue;
      diagnostics.push(
        diagnostic(
          token,
          fragment.code,
          "Heading fragment contains malformed percent encoding.",
        ),
      );
      continue;
    }

    if (fragment.value.startsWith("^")) {
      let target: ResolvedTarget;
      try {
        target = resolveTarget(sourcePath, token.linkPath);
      } catch {
        continue;
      }
      if (target.kind !== "file") continue;
      const targetPath = normalizeTargetPath(target.path);
      if (targetPath !== null && renameTargets.has(targetPath)) {
        diagnostics.push(
          diagnostic(
            token,
            "block-reference",
            "Block references are not heading rename targets.",
          ),
        );
      }
      continue;
    }

    if (!renameHeadings.has(fragment.value)) continue;

    let target: ResolvedTarget;
    try {
      target = resolveTarget(sourcePath, token.linkPath);
    } catch {
      diagnostics.push(
        diagnostic(
          token,
          "target-resolution-error",
          "Target resolution failed.",
        ),
      );
      continue;
    }
    const targetPath = appendRenameCandidateDiagnostic(
      diagnostics,
      token,
      target,
    );
    if (targetPath === null) continue;

    const matches = renameMap.get(`${targetPath}\u0000${fragment.value}`);
    if (!matches) continue;
    if (matches.length !== 1) {
      diagnostics.push(
        diagnostic(
          token,
          "duplicate-heading-rename",
          "Multiple renames share the same normalized file and heading identity.",
        ),
      );
      continue;
    }
    const rename = matches[0];
    if (!rename) continue;
    const localFrom = token.fragmentRange.from - token.range.from;
    const localTo = token.fragmentRange.to - token.range.from;
    const newFragment =
      token.kind === "wiki" || token.kind === "embed"
        ? encodeWikiHeadingFragment(rename.newHeading)
        : encodeURIComponent(rename.newHeading.normalize("NFC"));
    edits.push({
      range: token.range,
      replacement:
        token.raw.slice(0, localFrom) + newFragment + token.raw.slice(localTo),
      targetPath,
      reason: "unique-heading-rename",
    });
  }

  edits.sort((left, right) => left.range.from - right.range.from);
  diagnostics.sort(
    (left, right) => left.sourceRange.from - right.sourceRange.from,
  );
  return { edits, diagnostics };
}

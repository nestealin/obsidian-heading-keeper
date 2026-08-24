import { normalizeHeadingFragment } from "./fragments.js";
import { scanHeadingLinks } from "./tokenizer.js";
import type {
  HeadingRename,
  LinkDiagnostic,
  LinkEdit,
  LinkPlan,
  LinkToken,
  PlanHeadingLinkChangesInput,
} from "./types.js";

function normalizeTargetPath(path: string): string {
  const normalizedSegments: string[] = [];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (normalizedSegments.at(-1) !== "..") {
        normalizedSegments.pop();
      } else {
        normalizedSegments.push(segment);
      }
      continue;
    }
    normalizedSegments.push(segment.normalize("NFC"));
  }
  return normalizedSegments.join("/");
}

function identity(rename: HeadingRename): string | null {
  const heading = normalizeHeadingFragment(rename.oldHeading);
  return heading.ok
    ? `${normalizeTargetPath(rename.targetPath)}\u0000${heading.value}`
    : null;
}

function diagnostic(
  token: LinkToken,
  code: string,
  message: string,
): LinkDiagnostic {
  return { code, message, sourceRange: token.range };
}

function isExternalLinkPath(linkPath: string): boolean {
  return (
    linkPath.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(linkPath)
  );
}

export function planHeadingLinkChanges({
  sourcePath,
  markdown,
  renames,
  resolveTarget,
}: PlanHeadingLinkChangesInput): LinkPlan {
  const renamesByIdentity = new Map<string, HeadingRename[]>();
  for (const rename of renames) {
    const key = identity(rename);
    if (key === null) continue;
    const matches = renamesByIdentity.get(key);
    if (matches) {
      matches.push(rename);
    } else {
      renamesByIdentity.set(key, [rename]);
    }
  }

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
    const target = resolveTarget(sourcePath, token.linkPath);
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
    const matches = renamesByIdentity.get(
      `${targetPath}\u0000${fragment.value}`,
    );
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
        ? rename.newHeading.normalize("NFC")
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

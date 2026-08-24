import type { SourceRange } from "@heading-numbering/core";

export type LinkKind = "wiki" | "embed" | "markdown" | "image";

export interface LinkToken {
  kind: LinkKind;
  range: SourceRange;
  raw: string;
  linkPath: string;
  rawFragment: string | null;
  fragmentRange: SourceRange | null;
  alias: string | null;
  label: string | null;
  title: string | null;
  rawDestination: string | null;
  angleDestination: boolean;
}

export type ResolvedTarget =
  | { kind: "file"; path: string }
  | { kind: "missing" }
  | { kind: "ambiguous"; paths: readonly string[] }
  | { kind: "external" };

export interface HeadingRename {
  targetPath: string;
  oldHeading: string;
  newHeading: string;
}

export interface LinkEdit {
  range: SourceRange;
  replacement: string;
  targetPath: string;
  reason: "unique-heading-rename";
}

export interface LinkDiagnostic {
  code: string;
  message: string;
  sourceRange: SourceRange;
}

export interface LinkPlan {
  edits: LinkEdit[];
  diagnostics: LinkDiagnostic[];
}

export interface PlanHeadingLinkChangesInput {
  sourcePath: string;
  markdown: string;
  renames: readonly HeadingRename[];
  resolveTarget: (sourcePath: string, linkPath: string) => ResolvedTarget;
}

export type FragmentNormalization =
  | { ok: true; value: string }
  | { ok: false; code: "malformed-percent-encoding" };

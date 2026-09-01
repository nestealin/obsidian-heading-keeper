import {
  detectSafeHeadingRename,
  type UnsafeHeadingRenameReason,
} from "@heading-keeper/core";
import {
  planRenameScopedLinkChanges,
  type HeadingRename,
  type LinkDiagnosticCode,
  type ResolvedTarget,
} from "@heading-keeper/link-core";
import { buildLinkOnlyOperation } from "./persistence/plan-service.js";
import type {
  BuildPersistedOperationDependencies,
  PersistedOperation,
} from "./persistence/types.js";

export interface HeadingLinkSyncSource {
  readonly path: string;
  readonly text: string;
}

export interface AutomaticHeadingLinkSyncInput {
  readonly targetPath: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly sources: readonly HeadingLinkSyncSource[];
  readonly resolveTarget: (
    sourcePath: string,
    linkPath: string,
  ) => ResolvedTarget;
}

export interface HeadingLinkSyncDiagnostic {
  readonly path: string;
  readonly code: LinkDiagnosticCode;
}

export type AutomaticHeadingLinkSyncResult =
  | { readonly kind: "unsafe"; readonly reason: UnsafeHeadingRenameReason }
  | {
      readonly kind: "no-op";
      readonly rename: HeadingRename;
      readonly diagnostics: readonly HeadingLinkSyncDiagnostic[];
    }
  | {
      readonly kind: "operation";
      readonly rename: HeadingRename;
      readonly operation: PersistedOperation;
      readonly diagnostics: readonly HeadingLinkSyncDiagnostic[];
    };

export async function buildAutomaticHeadingLinkSync(
  input: AutomaticHeadingLinkSyncInput,
  dependencies: BuildPersistedOperationDependencies,
): Promise<AutomaticHeadingLinkSyncResult> {
  const detected = detectSafeHeadingRename(input.beforeText, input.afterText);
  if (detected.kind !== "safe") {
    return { kind: "unsafe", reason: detected.reason };
  }

  const rename: HeadingRename = {
    targetPath: input.targetPath,
    ...detected.rename,
  };
  const diagnostics: HeadingLinkSyncDiagnostic[] = [];
  const linkSources = [...input.sources]
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
    .map((source) => {
      const plan = planRenameScopedLinkChanges({
        sourcePath: source.path,
        markdown: source.text,
        renames: [rename],
        resolveTarget: input.resolveTarget,
      });
      diagnostics.push(
        ...plan.diagnostics.map((item) => ({
          path: source.path,
          code: item.code,
        })),
      );
      return {
        path: source.path,
        beforeText: source.text,
        edits: plan.edits.map((edit) => ({
          range: edit.range,
          expectedText: source.text.slice(edit.range.from, edit.range.to),
          replacementText: edit.replacement,
        })),
      };
    });

  const built = await buildLinkOnlyOperation({ linkSources }, dependencies);
  return built.kind === "no-op"
    ? { kind: "no-op", rename, diagnostics }
    : { kind: "operation", rename, operation: built.operation, diagnostics };
}

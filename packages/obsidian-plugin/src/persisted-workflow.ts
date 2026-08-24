import {
  buildNumberingPlan,
  scanHeadings,
  type NumberingPlan,
  type NumberingPlanEntry,
} from "@heading-numbering/core";
import {
  planHeadingLinkChanges,
  type HeadingRename,
  type ResolvedTarget,
} from "@heading-numbering/link-core";
import { buildPersistedOperation } from "./persistence/plan-service.js";
import type {
  BuildPersistedOperationDependencies,
  PersistedOperation,
  PlannedTextEdit,
} from "./persistence/types.js";
import type { StoredSettings } from "./settings.js";

export type WorkflowPreviewKind = "add" | "remove";

export interface MarkdownSource {
  readonly path: string;
  readonly text: string;
}

export interface WorkflowPreviewInput {
  readonly kind: WorkflowPreviewKind;
  readonly targetPath: string;
  readonly sources: readonly MarkdownSource[];
  readonly settings: StoredSettings;
  readonly resolveTarget: (
    sourcePath: string,
    linkPath: string,
  ) => ResolvedTarget;
}

export interface PreviewPreservedItem {
  readonly path: string;
  readonly code: string;
  readonly line?: number;
}

export interface PreviewGroups {
  readonly targetEdits: readonly PlannedTextEdit[];
  readonly linkSources: readonly {
    readonly path: string;
    readonly edits: readonly PlannedTextEdit[];
  }[];
  readonly preserved: readonly PreviewPreservedItem[];
  readonly skips: readonly PreviewPreservedItem[];
  readonly recoveryBoundary: readonly string[];
}

export type WorkflowPreviewResult =
  | { readonly kind: "no-op"; readonly groups: PreviewGroups }
  | {
      readonly kind: "preview";
      readonly previewKind: WorkflowPreviewKind;
      readonly planId: string;
      readonly targetPath: string;
      readonly operation: PersistedOperation;
      readonly groups: PreviewGroups;
    };

function stableSkipCode(
  entry: NumberingPlanEntry,
  plan: NumberingPlan,
  settings: StoredSettings,
): string {
  const diagnostic = plan.diagnostics.find(
    (item) => item.line === entry.heading.line,
  );
  if (diagnostic) return diagnostic.code;
  if (
    entry.heading.level < settings.topLevel ||
    entry.heading.level > settings.bottomLevel
  ) {
    return "heading-outside-range";
  }
  if (entry.heading.level > settings.topLevel) {
    return "heading-missing-top-level";
  }
  return "heading-not-numbered";
}

function removalArtifacts(
  plan: NumberingPlan,
  targetPath: string,
): { edits: PlannedTextEdit[]; renames: HeadingRename[] } {
  const edits: PlannedTextEdit[] = [];
  const renames: HeadingRename[] = [];
  for (const entry of plan.entries) {
    if (entry.ownership !== "exact") continue;
    const prefix = `${entry.displayPrefix}${plan.format.titleSeparator}`;
    const raw = entry.heading.rawText;
    const leadingLength = raw.length - raw.trimStart().length;
    const edit: PlannedTextEdit = {
      range: {
        from: entry.heading.contentRange.from + leadingLength,
        to: entry.heading.contentRange.from + leadingLength + prefix.length,
      },
      expectedText: prefix,
      replacementText: "",
    };
    if (raw.slice(leadingLength, leadingLength + prefix.length) !== prefix) {
      continue;
    }
    edits.push(edit);
    const oldHeading = raw.trim();
    renames.push({
      targetPath,
      oldHeading,
      newHeading: raw.trimStart().slice(prefix.length).trimEnd(),
    });
  }
  return { edits, renames };
}

function additionRenames(
  plan: NumberingPlan,
  targetPath: string,
): HeadingRename[] {
  return plan.entries.flatMap((entry) =>
    entry.edit
      ? [
          {
            targetPath,
            oldHeading: entry.heading.rawText.trim(),
            newHeading: entry.edit.replacementText.trim(),
          },
        ]
      : [],
  );
}

export async function buildWorkflowPreview(
  input: WorkflowPreviewInput,
  dependencies: BuildPersistedOperationDependencies,
): Promise<WorkflowPreviewResult> {
  if (input.settings.mode !== "persisted") {
    throw new Error("persisted-mode-required");
  }
  const target = input.sources.find(
    (source) => source.path === input.targetPath,
  );
  if (!target) throw new Error("target-source-missing");

  const numberingPlan = buildNumberingPlan(
    scanHeadings(target.text),
    input.settings,
  );
  const removal =
    input.kind === "remove"
      ? removalArtifacts(numberingPlan, input.targetPath)
      : { edits: [] as PlannedTextEdit[], renames: [] as HeadingRename[] };
  const renames =
    input.kind === "add"
      ? additionRenames(numberingPlan, input.targetPath)
      : removal.renames;

  const preserved: PreviewPreservedItem[] = [];
  const skips: PreviewPreservedItem[] = [];
  for (const entry of numberingPlan.entries) {
    if (entry.action === "skip") {
      skips.push({
        path: input.targetPath,
        code: stableSkipCode(entry, numberingPlan, input.settings),
        line: entry.heading.line,
      });
    } else if (
      entry.ownership === "semantic" ||
      entry.ownership === "ambiguous"
    ) {
      preserved.push({
        path: input.targetPath,
        code:
          entry.ownership === "semantic"
            ? "semantic-prefix"
            : "ambiguous-prefix",
        line: entry.heading.line,
      });
    }
  }

  const linkSources = [...input.sources]
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
    .map((source) => {
      const linkPlan = planHeadingLinkChanges({
        sourcePath: source.path,
        markdown: source.text,
        renames,
        resolveTarget: input.resolveTarget,
      });
      preserved.push(
        ...linkPlan.diagnostics.map((diagnostic) => ({
          path: source.path,
          code: diagnostic.code,
        })),
      );
      return {
        path: source.path,
        beforeText: source.text,
        edits: linkPlan.edits.map((edit) => ({
          range: edit.range,
          expectedText: source.text.slice(edit.range.from, edit.range.to),
          replacementText: edit.replacement,
        })),
      };
    });

  const targetEdits =
    input.kind === "add"
      ? numberingPlan.entries.flatMap((entry) =>
          entry.edit ? [entry.edit] : [],
        )
      : removal.edits;
  const built = await buildPersistedOperation(
    {
      target: {
        path: input.targetPath,
        beforeText: target.text,
        numberingPlan,
        linkEdits: input.kind === "remove" ? removal.edits : [],
      },
      linkSources,
    },
    dependencies,
  );
  const groups: PreviewGroups = {
    targetEdits,
    linkSources: linkSources
      .filter((source) => source.edits.length > 0)
      .map((source) => ({ path: source.path, edits: source.edits })),
    preserved,
    skips,
    recoveryBoundary: ["source-hash-preflight", "external-change-preserved"],
  };
  return built.kind === "no-op"
    ? { kind: "no-op", groups }
    : {
        kind: "preview",
        previewKind: input.kind,
        planId: built.operation.id,
        targetPath: input.targetPath,
        operation: built.operation,
        groups,
      };
}

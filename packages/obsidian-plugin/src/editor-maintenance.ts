import { buildNumberingPlan, scanHeadings } from "@heading-keeper/core";
import type { HeadingRename } from "@heading-keeper/link-core";
import { applyCheckedEdits } from "./persistence/edits.js";
import type { PlannedTextEdit } from "./persistence/types.js";
import type { StoredSettings } from "./settings.js";

export interface EditorMaintenanceSnapshot {
  readonly path: string | null;
  readonly text: string;
  readonly generation: number;
  readonly composing: boolean;
  readonly compositionStarted: boolean;
  readonly unique: boolean;
}

export interface EditorMaterialization {
  readonly afterText: string;
  readonly edits: readonly PlannedTextEdit[];
  readonly renames: readonly HeadingRename[];
}

export interface EditorMaintenanceDependencies {
  readonly current: () => EditorMaintenanceSnapshot;
  readonly settings: () => StoredSettings;
  readonly stage: (materialization: EditorMaterialization) => Promise<string>;
  readonly cancel: (intentId: string) => Promise<unknown>;
  readonly dispatch: (edits: readonly PlannedTextEdit[]) => unknown;
}

export function planEditorMaterialization(
  path: string,
  markdown: string,
  settings: StoredSettings,
): EditorMaterialization | null {
  if (settings.mode !== "persisted") return null;
  const plan = buildNumberingPlan(scanHeadings(markdown), settings);
  const entries = plan.entries.filter(
    (entry): entry is typeof entry & { edit: PlannedTextEdit } =>
      entry.edit !== undefined,
  );
  if (entries.length === 0) return null;
  const edits = entries.map((entry) => minimizeTextEdit(entry.edit));
  return {
    afterText: applyCheckedEdits(markdown, edits),
    edits,
    renames: entries.map((entry) => ({
      targetPath: path,
      oldHeading: entry.heading.rawText.trim(),
      newHeading: entry.edit.replacementText.trim(),
    })),
  };
}

export async function runEditorMaintenanceOnce(
  dependencies: EditorMaintenanceDependencies,
): Promise<"applied" | "deferred" | "no-op" | "stale"> {
  const initial = dependencies.current();
  if (!safeSnapshot(initial)) return "deferred";
  const initialSettings = dependencies.settings();
  const materialization = planEditorMaterialization(
    initial.path,
    initial.text,
    initialSettings,
  );
  if (!materialization) return "no-op";

  const intentId = await dependencies.stage(materialization);
  const current = dependencies.current();
  if (
    !sameSettings(dependencies.settings(), initialSettings) ||
    !safeSnapshot(current) ||
    current.path !== initial.path ||
    current.generation !== initial.generation ||
    current.text !== initial.text
  ) {
    await dependencies.cancel(intentId);
    return "stale";
  }

  dependencies.dispatch(materialization.edits);
  return "applied";
}

function sameSettings(left: StoredSettings, right: StoredSettings): boolean {
  return (
    left.topLevel === right.topLevel &&
    left.bottomLevel === right.bottomLevel &&
    left.startAt === right.startAt &&
    left.numberSeparator === right.numberSeparator &&
    left.titleSeparator === right.titleSeparator &&
    left.gapStrategy === right.gapStrategy &&
    left.mode === right.mode &&
    left.locale === right.locale &&
    left.updateHeadingLinks === right.updateHeadingLinks
  );
}

function safeSnapshot(
  snapshot: EditorMaintenanceSnapshot,
): snapshot is EditorMaintenanceSnapshot & { readonly path: string } {
  return (
    snapshot.path !== null &&
    snapshot.unique &&
    !snapshot.composing &&
    !snapshot.compositionStarted
  );
}

function minimizeTextEdit(edit: PlannedTextEdit): PlannedTextEdit {
  let prefixLength = 0;
  while (
    prefixLength < edit.expectedText.length &&
    prefixLength < edit.replacementText.length &&
    edit.expectedText[prefixLength] === edit.replacementText[prefixLength]
  ) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < edit.expectedText.length - prefixLength &&
    suffixLength < edit.replacementText.length - prefixLength &&
    edit.expectedText[edit.expectedText.length - 1 - suffixLength] ===
      edit.replacementText[edit.replacementText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }
  return {
    range: {
      from: edit.range.from + prefixLength,
      to: edit.range.to - suffixLength,
    },
    expectedText: edit.expectedText.slice(
      prefixLength,
      edit.expectedText.length - suffixLength,
    ),
    replacementText: edit.replacementText.slice(
      prefixLength,
      edit.replacementText.length - suffixLength,
    ),
  };
}

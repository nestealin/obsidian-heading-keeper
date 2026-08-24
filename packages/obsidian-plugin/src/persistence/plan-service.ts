import { applyPlan } from "@heading-numbering/core";
import type {
  BuildPersistedOperationDependencies,
  BuildPersistedOperationInput,
  BuildPersistedOperationResult,
  PlannedFileRole,
  PlannedTextEdit,
} from "./types.js";
import { snapshotOperation } from "./journal.js";

export type PersistedPlanErrorCode =
  | "invalid-target-plan"
  | "range-invalid"
  | "expected-text-mismatch"
  | "edit-overlap"
  | "source-text-conflict";

export class PersistedPlanError extends Error {
  readonly name = "PersistedPlanError";

  constructor(readonly code: PersistedPlanErrorCode) {
    super(code);
  }
}

export async function sha256Text(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

interface MutableFilePlan {
  readonly path: string;
  readonly beforeText: string;
  readonly role: PlannedFileRole;
  readonly edits: PlannedTextEdit[];
}

function copiedEdit(edit: PlannedTextEdit): PlannedTextEdit {
  return {
    range: { from: edit.range.from, to: edit.range.to },
    expectedText: edit.expectedText,
    replacementText: edit.replacementText,
  };
}

function applyVerifiedEdits(
  beforeText: string,
  edits: readonly PlannedTextEdit[],
): string {
  const ordered = edits
    .map(copiedEdit)
    .sort(
      (left, right) =>
        left.range.from - right.range.from || left.range.to - right.range.to,
    );
  for (let index = 0; index < ordered.length; index += 1) {
    const edit = ordered[index]!;
    const { from, to } = edit.range;
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to < from ||
      to > beforeText.length
    ) {
      throw new PersistedPlanError("range-invalid");
    }
    if (beforeText.slice(from, to) !== edit.expectedText) {
      throw new PersistedPlanError("expected-text-mismatch");
    }
    const previous = ordered[index - 1];
    if (
      previous &&
      (from < previous.range.to ||
        (from === to &&
          previous.range.from === previous.range.to &&
          from === previous.range.from))
    ) {
      throw new PersistedPlanError("edit-overlap");
    }
  }

  let result = beforeText;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const edit = ordered[index]!;
    result =
      result.slice(0, edit.range.from) +
      edit.replacementText +
      result.slice(edit.range.to);
  }
  return result;
}

export async function buildPersistedOperation(
  input: BuildPersistedOperationInput,
  dependencies: BuildPersistedOperationDependencies,
): Promise<BuildPersistedOperationResult> {
  const targetPath = input.target.path;
  const targetBefore = input.target.beforeText;
  let targetAfter: string;
  try {
    targetAfter = applyPlan(targetBefore, input.target.numberingPlan);
  } catch {
    throw new PersistedPlanError("invalid-target-plan");
  }
  const targetNumberingEdits = input.target.numberingPlan.entries.flatMap(
    (entry) => (entry.edit ? [copiedEdit(entry.edit)] : []),
  );
  const files = new Map<string, MutableFilePlan>();
  files.set(targetPath, {
    path: targetPath,
    beforeText: targetBefore,
    role: "target",
    edits: [...targetNumberingEdits, ...input.target.linkEdits.map(copiedEdit)],
  });

  for (const source of input.linkSources) {
    const path = source.path;
    const beforeText = source.beforeText;
    const existing = files.get(path);
    if (existing) {
      if (existing.beforeText !== beforeText) {
        throw new PersistedPlanError("source-text-conflict");
      }
      existing.edits.push(...source.edits.map(copiedEdit));
    } else {
      files.set(path, {
        path,
        beforeText,
        role: "link-source",
        edits: source.edits.map(copiedEdit),
      });
    }
  }

  const materialized = [...files.values()]
    .map((file) => ({
      ...file,
      afterText: applyVerifiedEdits(file.beforeText, file.edits),
    }))
    .filter((file) => file.afterText !== file.beforeText)
    .sort((left, right) => {
      if (left.role !== right.role) return left.role === "target" ? -1 : 1;
      return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    });
  if (materialized.length === 0) return { kind: "no-op" };

  // applyPlan remains the authority for target-plan integrity; the edit replay
  // must agree with its output before target link edits are added.
  if (applyVerifiedEdits(targetBefore, targetNumberingEdits) !== targetAfter) {
    throw new PersistedPlanError("invalid-target-plan");
  }

  const plannedFiles = await Promise.all(
    materialized.map(async (file) => ({
      path: file.path,
      beforeHash: await dependencies.hashText(file.beforeText),
      beforeText: file.beforeText,
      afterHash: await dependencies.hashText(file.afterText),
      afterText: file.afterText,
      role: file.role,
    })),
  );

  return {
    kind: "operation",
    operation: snapshotOperation({
      id: dependencies.createId(),
      createdAt: dependencies.now(),
      state: "previewed",
      files: plannedFiles,
      completedPaths: [],
    }),
  };
}

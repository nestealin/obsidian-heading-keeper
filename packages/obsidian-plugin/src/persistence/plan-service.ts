import { applyPlan } from "@heading-keeper/core";
import type {
  BuildPersistedOperationDependencies,
  BuildPersistedOperationInput,
  BuildPersistedOperationResult,
  LinkSourcePlanInput,
  PlannedFileRole,
  PlannedTextEdit,
} from "./types.js";
import { snapshotOperation } from "./journal.js";
import {
  applyCheckedEdits,
  CheckedEditError,
  copyEdit,
  invertEdits,
} from "./edits.js";

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

export async function sha256Text(
  text: string,
  cryptoSource: Pick<Crypto, "subtle"> = crypto,
): Promise<string> {
  const digest = await cryptoSource.subtle.digest(
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

export interface BuildLinkOnlyOperationInput {
  readonly linkSources: readonly LinkSourcePlanInput[];
}

function minimalTextEdit(edit: PlannedTextEdit): PlannedTextEdit {
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

function applyVerifiedEdits(
  beforeText: string,
  edits: readonly PlannedTextEdit[],
): string {
  try {
    return applyCheckedEdits(beforeText, edits);
  } catch (error) {
    if (error instanceof CheckedEditError) {
      throw new PersistedPlanError(error.code);
    }
    throw error;
  }
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
    if (applyPlan(targetAfter, input.target.numberingPlan) !== targetAfter) {
      throw new PersistedPlanError("invalid-target-plan");
    }
  } catch {
    throw new PersistedPlanError("invalid-target-plan");
  }
  const targetNumberingEdits = input.target.numberingPlan.entries.flatMap(
    (entry) => (entry.edit ? [copyEdit(entry.edit)] : []),
  );
  if (
    input.target.numberingMaterialization !== "insert" &&
    input.target.numberingMaterialization !== "validate-only"
  ) {
    throw new PersistedPlanError("invalid-target-plan");
  }
  const targetNumberingInsertions =
    input.target.numberingMaterialization === "insert"
      ? targetNumberingEdits.map(minimalTextEdit)
      : [];
  const files = new Map<string, MutableFilePlan>();
  files.set(targetPath, {
    path: targetPath,
    beforeText: targetBefore,
    role: "target",
    edits: [
      ...targetNumberingInsertions,
      ...input.target.linkEdits.map(copyEdit),
    ],
  });

  for (const source of input.linkSources) {
    const path = source.path;
    const beforeText = source.beforeText;
    const existing = files.get(path);
    if (existing) {
      if (existing.beforeText !== beforeText) {
        throw new PersistedPlanError("source-text-conflict");
      }
      existing.edits.push(...source.edits.map(copyEdit));
    } else {
      files.set(path, {
        path,
        beforeText,
        role: "link-source",
        edits: source.edits.map(copyEdit),
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

  // applyPlan remains the authority for target-plan integrity. Persisted writes
  // replay only the minimal verified numbering difference so nested heading-link edits can
  // compose without weakening the complete-plan check.
  if (
    input.target.numberingMaterialization === "insert" &&
    applyVerifiedEdits(targetBefore, targetNumberingInsertions) !== targetAfter
  ) {
    throw new PersistedPlanError("invalid-target-plan");
  }

  const plannedFiles = await Promise.all(
    materialized.map(async (file) => ({
      path: file.path,
      beforeHash: await dependencies.hashText(file.beforeText),
      afterHash: await dependencies.hashText(file.afterText),
      edits: file.edits.map(copyEdit),
      inverseEdits: invertEdits(file.beforeText, file.edits),
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

export async function buildLinkOnlyOperation(
  input: BuildLinkOnlyOperationInput,
  dependencies: BuildPersistedOperationDependencies,
): Promise<BuildPersistedOperationResult> {
  const files = new Map<string, MutableFilePlan>();
  for (const source of input.linkSources) {
    const beforeText = source.beforeText;
    const existing = files.get(source.path);
    if (existing) {
      if (existing.beforeText !== beforeText) {
        throw new PersistedPlanError("source-text-conflict");
      }
      existing.edits.push(...source.edits.map(copyEdit));
    } else {
      files.set(source.path, {
        path: source.path,
        beforeText,
        role: "link-source",
        edits: source.edits.map(copyEdit),
      });
    }
  }

  const materialized = [...files.values()]
    .map((file) => ({
      ...file,
      afterText: applyVerifiedEdits(file.beforeText, file.edits),
    }))
    .filter((file) => file.afterText !== file.beforeText)
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  if (materialized.length === 0) return { kind: "no-op" };

  const plannedFiles = await Promise.all(
    materialized.map(async (file) => ({
      path: file.path,
      beforeHash: await dependencies.hashText(file.beforeText),
      afterHash: await dependencies.hashText(file.afterText),
      edits: file.edits.map(copyEdit),
      inverseEdits: invertEdits(file.beforeText, file.edits),
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

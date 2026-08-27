import { snapshotOperation } from "./journal.js";
import type {
  HashText,
  OperationState,
  PersistedOperation,
  PlannedTextEdit,
} from "./types.js";

export type OperationValidationMode = "execute-caller" | "durable" | "restore";

export type OperationValidationResult =
  | { readonly ok: true; readonly operation: PersistedOperation }
  | {
      readonly ok: false;
      readonly code: "operation-invalid" | "operation-hash-error";
    };

const operationStates: readonly OperationState[] = [
  "previewed",
  "applying",
  "completed",
  "recovery-required",
  "restoring",
  "restored",
];

const restoreStates: readonly OperationState[] = [
  "applying",
  "completed",
  "recovery-required",
  "restoring",
  "restored",
];

function validState(
  state: OperationState,
  mode: OperationValidationMode,
): boolean {
  if (!operationStates.includes(state)) return false;
  if (mode === "execute-caller") {
    return state === "previewed" || state === "completed";
  }
  if (mode === "restore") return restoreStates.includes(state);
  return true;
}

function validEdit(edit: PlannedTextEdit): boolean {
  return (
    Number.isSafeInteger(edit.range.from) &&
    Number.isSafeInteger(edit.range.to) &&
    edit.range.from >= 0 &&
    edit.range.to >= edit.range.from &&
    edit.expectedText.length === edit.range.to - edit.range.from &&
    edit.expectedText !== edit.replacementText
  );
}

function validEditPair(
  edits: readonly PlannedTextEdit[],
  inverseEdits: readonly PlannedTextEdit[],
): boolean {
  if (edits.length === 0 || edits.length !== inverseEdits.length) return false;
  const ordered = [...edits].sort(
    (left, right) =>
      left.range.from - right.range.from || left.range.to - right.range.to,
  );
  let delta = 0;
  let previousEnd = -1;
  for (let index = 0; index < ordered.length; index += 1) {
    const edit = ordered[index]!;
    const inverse = inverseEdits[index];
    if (!inverse || !validEdit(edit) || !validEdit(inverse)) return false;
    if (edit.range.from < previousEnd) return false;
    if (
      edit.range.from === edit.range.to &&
      edit.range.from === previousEnd &&
      index > 0
    ) {
      return false;
    }
    const inverseFrom = edit.range.from + delta;
    if (
      inverse.range.from !== inverseFrom ||
      inverse.range.to !== inverseFrom + edit.replacementText.length ||
      inverse.expectedText !== edit.replacementText ||
      inverse.replacementText !== edit.expectedText
    ) {
      return false;
    }
    previousEnd = edit.range.to;
    delta += edit.replacementText.length - edit.expectedText.length;
  }
  return true;
}

function structurallyValid(
  operation: PersistedOperation,
  mode: OperationValidationMode,
): boolean {
  if (
    operation.id.length === 0 ||
    operation.createdAt.length === 0 ||
    operation.files.length === 0 ||
    !validState(operation.state, mode)
  ) {
    return false;
  }

  const paths = new Set<string>();
  let targetCount = 0;
  let previousLinkPath: string | undefined;
  for (let index = 0; index < operation.files.length; index += 1) {
    const file = operation.files[index]!;
    if (
      file.path.trim().length === 0 ||
      paths.has(file.path) ||
      file.beforeHash.length === 0 ||
      file.afterHash.length === 0 ||
      file.beforeHash === file.afterHash ||
      !validEditPair(file.edits, file.inverseEdits) ||
      (file.role !== "target" && file.role !== "link-source")
    ) {
      return false;
    }
    paths.add(file.path);
    if (file.role === "target") {
      targetCount += 1;
      if (targetCount > 1 || index !== 0) return false;
    } else {
      if (previousLinkPath !== undefined && previousLinkPath >= file.path) {
        return false;
      }
      previousLinkPath = file.path;
    }
  }

  const completed = new Set<string>();
  for (const path of operation.completedPaths) {
    if (completed.has(path) || !paths.has(path)) return false;
    completed.add(path);
  }
  if (operation.state === "previewed" && completed.size !== 0) return false;
  if (operation.state === "completed" && completed.size !== paths.size) {
    return false;
  }
  return true;
}

export async function validatePersistedOperation(
  operation: PersistedOperation,
  _hashText: HashText,
  mode: OperationValidationMode,
): Promise<OperationValidationResult> {
  let snapshot: PersistedOperation;
  try {
    snapshot = snapshotOperation(operation);
    if (!structurallyValid(snapshot, mode)) {
      return { ok: false, code: "operation-invalid" };
    }
  } catch {
    return { ok: false, code: "operation-invalid" };
  }

  return { ok: true, operation: snapshot };
}

export function sameOperationIdentity(
  left: PersistedOperation,
  right: PersistedOperation,
): boolean {
  if (
    left.id !== right.id ||
    left.createdAt !== right.createdAt ||
    left.files.length !== right.files.length
  ) {
    return false;
  }
  return left.files.every((file, index) => {
    const other = right.files[index];
    return (
      other !== undefined &&
      file.path === other.path &&
      file.beforeHash === other.beforeHash &&
      file.afterHash === other.afterHash &&
      file.role === other.role &&
      JSON.stringify(file.edits) === JSON.stringify(other.edits) &&
      JSON.stringify(file.inverseEdits) === JSON.stringify(other.inverseEdits)
    );
  });
}

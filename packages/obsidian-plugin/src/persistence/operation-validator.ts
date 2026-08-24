import { snapshotOperation } from "./journal.js";
import type { HashText, OperationState, PersistedOperation } from "./types.js";

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
  if (mode === "execute-caller") return state === "previewed";
  if (mode === "restore") return restoreStates.includes(state);
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
      file.beforeText === file.afterText ||
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
  hashText: HashText,
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

  try {
    const hashes: string[] = [];
    for (const file of snapshot.files) {
      hashes.push(await hashText(file.beforeText));
      hashes.push(await hashText(file.afterText));
    }
    for (let index = 0; index < snapshot.files.length; index += 1) {
      const file = snapshot.files[index]!;
      if (
        hashes[index * 2] !== file.beforeHash ||
        hashes[index * 2 + 1] !== file.afterHash
      ) {
        return { ok: false, code: "operation-invalid" };
      }
    }
  } catch {
    return { ok: false, code: "operation-hash-error" };
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
      file.beforeText === other.beforeText &&
      file.afterHash === other.afterHash &&
      file.afterText === other.afterText &&
      file.role === other.role
    );
  });
}

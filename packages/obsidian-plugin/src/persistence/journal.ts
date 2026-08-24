import type { OperationState, PersistedOperation } from "./types.js";

export function snapshotOperation(
  operation: PersistedOperation,
  state: OperationState = operation.state,
  completedPaths: readonly string[] = operation.completedPaths,
): PersistedOperation {
  const files = operation.files.map((file) => Object.freeze({ ...file }));
  return Object.freeze({
    id: operation.id,
    createdAt: operation.createdAt,
    state,
    files: Object.freeze(files),
    completedPaths: Object.freeze([...completedPaths]),
  });
}

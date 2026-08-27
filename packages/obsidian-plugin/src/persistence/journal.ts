import type { OperationState, PersistedOperation } from "./types.js";

export function snapshotOperation(
  operation: PersistedOperation,
  state: OperationState = operation.state,
  completedPaths: readonly string[] = operation.completedPaths,
): PersistedOperation {
  const files = operation.files.map((file) =>
    Object.freeze({
      ...file,
      edits: Object.freeze(
        file.edits.map((edit) =>
          Object.freeze({
            ...edit,
            range: Object.freeze({ ...edit.range }),
          }),
        ),
      ),
      inverseEdits: Object.freeze(
        file.inverseEdits.map((edit) =>
          Object.freeze({
            ...edit,
            range: Object.freeze({ ...edit.range }),
          }),
        ),
      ),
    }),
  );
  return Object.freeze({
    id: operation.id,
    createdAt: operation.createdAt,
    state,
    files: Object.freeze(files),
    completedPaths: Object.freeze([...completedPaths]),
  });
}

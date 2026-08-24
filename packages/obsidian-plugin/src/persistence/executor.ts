import type {
  ExecutionResult,
  PersistedOperation,
  PersistenceDependencies,
  RecoveryInspection,
  RestoreResult,
} from "./types.js";
import { snapshotOperation } from "./journal.js";

async function exactImage(
  text: string,
  expectedText: string,
  expectedHash: string,
  dependencies: PersistenceDependencies,
): Promise<boolean> {
  return (
    text === expectedText &&
    (await dependencies.hashText(text)) === expectedHash
  );
}

async function recoveryResult(
  operation: PersistedOperation,
  code: string,
  dependencies: PersistenceDependencies,
): Promise<ExecutionResult> {
  const recovery = snapshotOperation(operation, "recovery-required");
  try {
    await dependencies.journal.save(recovery);
    return { kind: "recovery-required", code, operation: recovery };
  } catch {
    return {
      kind: "journal-error",
      code: "journal-error",
      operation: recovery,
    };
  }
}

export async function executePersistedOperation(
  operation: PersistedOperation,
  dependencies: PersistenceDependencies,
): Promise<ExecutionResult> {
  if (operation.state === "completed") {
    return { kind: "completed", operation: snapshotOperation(operation) };
  }
  let durable: PersistedOperation | null;
  try {
    durable = await dependencies.journal.load(operation.id);
  } catch {
    return {
      kind: "journal-error",
      code: "journal-error",
      operation: snapshotOperation(operation),
    };
  }
  if (durable?.state === "completed") {
    return { kind: "completed", operation: snapshotOperation(durable) };
  }
  if (durable && durable.state !== "previewed") {
    return {
      kind: "recovery-required",
      code: "operation-already-started",
      operation: snapshotOperation(durable, "recovery-required"),
    };
  }

  let preflightFailure: ExecutionResult | null = null;
  for (const file of operation.files) {
    let current: string;
    try {
      current = await dependencies.vault.read(file.path);
      if (
        !(await exactImage(
          current,
          file.beforeText,
          file.beforeHash,
          dependencies,
        )) &&
        preflightFailure === null
      ) {
        preflightFailure = {
          kind: "stale-plan",
          code: "source-stale",
          path: file.path,
          operation: snapshotOperation(operation),
        };
      }
    } catch {
      if (preflightFailure === null)
        preflightFailure = {
          kind: "recovery-required",
          code: "source-read-error",
          operation: snapshotOperation(operation, "recovery-required"),
        };
    }
  }
  if (preflightFailure) return preflightFailure;

  let currentOperation = snapshotOperation(operation, "applying", []);
  try {
    await dependencies.journal.save(currentOperation);
  } catch {
    return {
      kind: "journal-error",
      code: "journal-error",
      operation: currentOperation,
    };
  }

  const completedPaths: string[] = [];
  for (const file of currentOperation.files) {
    try {
      await dependencies.vault.write(file.path, file.afterText);
    } catch {
      return recoveryResult(currentOperation, "write-error", dependencies);
    }

    let readBack: string;
    try {
      readBack = await dependencies.vault.read(file.path);
      if (
        !(await exactImage(
          readBack,
          file.afterText,
          file.afterHash,
          dependencies,
        ))
      ) {
        return recoveryResult(
          currentOperation,
          "readback-mismatch",
          dependencies,
        );
      }
    } catch {
      return recoveryResult(currentOperation, "readback-error", dependencies);
    }

    completedPaths.push(file.path);
    currentOperation = snapshotOperation(
      currentOperation,
      "applying",
      completedPaths,
    );
    try {
      await dependencies.journal.save(currentOperation);
    } catch {
      return recoveryResult(
        currentOperation,
        "journal-progress-error",
        dependencies,
      );
    }
  }

  const completed = snapshotOperation(
    currentOperation,
    "completed",
    completedPaths,
  );
  try {
    await dependencies.journal.save(completed);
  } catch {
    return recoveryResult(completed, "journal-completion-error", dependencies);
  }
  return { kind: "completed", operation: completed };
}

export async function inspectRecovery(
  operation: PersistedOperation,
  dependencies: PersistenceDependencies,
): Promise<RecoveryInspection> {
  const files: RecoveryInspection["files"][number][] = [];
  const diagnostics: RecoveryInspection["diagnostics"][number][] = [];
  const completed = new Set(operation.completedPaths);
  for (const file of operation.files) {
    try {
      const current = await dependencies.vault.read(file.path);
      const currentHash = await dependencies.hashText(current);
      let status: RecoveryInspection["files"][number]["status"];
      if (current === file.afterText && currentHash === file.afterHash) {
        status = "eligible";
      } else if (
        current === file.beforeText &&
        currentHash === file.beforeHash
      ) {
        status = completed.has(file.path) ? "restored" : "pending";
      } else {
        status = "changed";
      }
      files.push({ path: file.path, role: file.role, status });
    } catch {
      files.push({ path: file.path, role: file.role, status: "changed" });
      diagnostics.push({
        code: "recovery-read-error",
        path: file.path,
        message: "Unable to inspect current file.",
      });
    }
  }
  return { kind: "inspected", files, diagnostics };
}

async function restoreFailure(
  operation: PersistedOperation,
  code: string,
  dependencies: PersistenceDependencies,
): Promise<RestoreResult> {
  const recovery = snapshotOperation(operation, "recovery-required");
  try {
    await dependencies.journal.save(recovery);
    return { kind: "recovery-required", code, operation: recovery };
  } catch {
    return {
      kind: "journal-error",
      code: "journal-error",
      operation: recovery,
    };
  }
}

export async function restoreEligibleFiles(
  operation: PersistedOperation,
  dependencies: PersistenceDependencies,
): Promise<RestoreResult> {
  const initial = await inspectRecovery(operation, dependencies);
  const eligible = new Set(
    initial.files
      .filter((file) => file.status === "eligible")
      .map((file) => file.path),
  );
  const appliedPaths = new Set(operation.completedPaths);
  for (const path of eligible) appliedPaths.add(path);

  let currentOperation = snapshotOperation(
    operation,
    "restoring",
    operation.files
      .map((file) => file.path)
      .filter((path) => appliedPaths.has(path)),
  );

  if (eligible.size > 0) {
    try {
      await dependencies.journal.save(currentOperation);
    } catch {
      return {
        kind: "journal-error",
        code: "journal-error",
        operation: currentOperation,
      };
    }
  }

  for (let index = currentOperation.files.length - 1; index >= 0; index -= 1) {
    const file = currentOperation.files[index]!;
    if (!eligible.has(file.path)) continue;
    try {
      await dependencies.vault.write(file.path, file.beforeText);
    } catch {
      return restoreFailure(
        currentOperation,
        "restore-write-error",
        dependencies,
      );
    }
    try {
      const readBack = await dependencies.vault.read(file.path);
      if (
        !(await exactImage(
          readBack,
          file.beforeText,
          file.beforeHash,
          dependencies,
        ))
      ) {
        return restoreFailure(
          currentOperation,
          "restore-readback-mismatch",
          dependencies,
        );
      }
    } catch {
      return restoreFailure(
        currentOperation,
        "restore-readback-error",
        dependencies,
      );
    }
    try {
      await dependencies.journal.save(currentOperation);
    } catch {
      return restoreFailure(
        currentOperation,
        "restore-journal-progress-error",
        dependencies,
      );
    }
  }

  const finalInspection = await inspectRecovery(currentOperation, dependencies);
  const unsafe = finalInspection.files.some(
    (file) => file.status === "changed" || file.status === "eligible",
  );
  const finalOperation = snapshotOperation(
    currentOperation,
    unsafe ? "recovery-required" : "restored",
  );
  try {
    await dependencies.journal.save(finalOperation);
  } catch {
    return {
      kind: "journal-error",
      code: "journal-error",
      operation: finalOperation,
    };
  }
  return unsafe
    ? {
        kind: "recovery-required",
        code: "recovery-conflict",
        operation: finalOperation,
      }
    : { kind: "restored", operation: finalOperation };
}

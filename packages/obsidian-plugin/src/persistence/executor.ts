import type {
  ExecutionResult,
  PersistedOperation,
  PersistenceDependencies,
  RecoveryInspection,
  RestoreResult,
} from "./types.js";
import { snapshotOperation } from "./journal.js";
import {
  sameOperationIdentity,
  validatePersistedOperation,
} from "./operation-validator.js";

function safeSnapshotOperation(
  operation: PersistedOperation,
): PersistedOperation {
  try {
    return snapshotOperation(operation);
  } catch {
    return operation;
  }
}

function invalidExecutionResult(
  operation: PersistedOperation,
  code: "operation-invalid" | "operation-hash-error" | "operation-conflict",
): ExecutionResult {
  return {
    kind: "recovery-required",
    code,
    operation: safeSnapshotOperation(operation),
  };
}

async function imageHash(
  path: string,
  dependencies: PersistenceDependencies,
): Promise<string> {
  return dependencies.hashText(await dependencies.vault.read(path));
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
  const callerValidation = await validatePersistedOperation(
    operation,
    dependencies.hashText,
    "execute-caller",
  );
  if (!callerValidation.ok) {
    return invalidExecutionResult(operation, callerValidation.code);
  }
  const caller = callerValidation.operation;
  let durable: PersistedOperation | null;
  try {
    durable = await dependencies.journal.load(caller.id);
  } catch {
    return {
      kind: "journal-error",
      code: "journal-error",
      operation: caller,
    };
  }
  let executable = caller;
  if (!durable) {
    if (caller.state === "completed") {
      return invalidExecutionResult(caller, "operation-conflict");
    }
  } else {
    const durableValidation = await validatePersistedOperation(
      durable,
      dependencies.hashText,
      "durable",
    );
    if (!durableValidation.ok) {
      return invalidExecutionResult(durable, durableValidation.code);
    }
    const durableSnapshot = durableValidation.operation;
    if (!sameOperationIdentity(caller, durableSnapshot)) {
      return invalidExecutionResult(durableSnapshot, "operation-conflict");
    }
    if (caller.state === "completed") {
      return durableSnapshot.state === "completed"
        ? { kind: "completed", operation: durableSnapshot }
        : invalidExecutionResult(durableSnapshot, "operation-conflict");
    }
    if (durableSnapshot.state === "completed") {
      return { kind: "completed", operation: durableSnapshot };
    }
    if (
      durableSnapshot.state === "restoring" ||
      durableSnapshot.state === "restored"
    ) {
      return {
        kind: "recovery-required",
        code: "operation-conflict",
        operation: durableSnapshot,
      };
    }
    executable = durableSnapshot;
  }

  let preflightFailure: ExecutionResult | null = null;
  const alreadyApplied: string[] = [];
  for (const file of executable.files) {
    try {
      const currentHash = await imageHash(file.path, dependencies);
      if (currentHash === file.afterHash) {
        alreadyApplied.push(file.path);
      } else if (currentHash !== file.beforeHash && preflightFailure === null) {
        preflightFailure = {
          kind: "stale-plan",
          code: "source-stale",
          path: file.path,
          operation: executable,
        };
      }
    } catch {
      if (preflightFailure === null)
        preflightFailure = {
          kind: "recovery-required",
          code: "source-read-error",
          operation: snapshotOperation(executable, "recovery-required"),
        };
    }
  }
  if (preflightFailure) return preflightFailure;

  let currentOperation = snapshotOperation(
    executable,
    "applying",
    alreadyApplied,
  );
  try {
    await dependencies.journal.save(currentOperation);
  } catch {
    return {
      kind: "journal-error",
      code: "journal-error",
      operation: currentOperation,
    };
  }

  const completedPaths = [...alreadyApplied];
  for (const file of currentOperation.files) {
    if (completedPaths.includes(file.path)) continue;
    let updateResult;
    try {
      updateResult = await dependencies.vault.compareAndUpdate(
        file.path,
        file.beforeHash,
        file.afterHash,
        file.edits,
        dependencies.hashText,
      );
    } catch {
      return recoveryResult(currentOperation, "write-error", dependencies);
    }
    if (updateResult.kind === "stale") {
      return recoveryResult(currentOperation, "source-stale", dependencies);
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
      const currentHash = await imageHash(file.path, dependencies);
      let status: RecoveryInspection["files"][number]["status"];
      if (currentHash === file.afterHash) {
        status = "eligible";
      } else if (currentHash === file.beforeHash) {
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
  const validation = await validatePersistedOperation(
    operation,
    dependencies.hashText,
    "restore",
  );
  if (!validation.ok) {
    return {
      kind: "recovery-required",
      code: validation.code,
      operation: safeSnapshotOperation(operation),
    };
  }
  const recoverable = validation.operation;
  const initial = await inspectRecovery(recoverable, dependencies);
  const eligible = new Set(
    initial.files
      .filter((file) => file.status === "eligible")
      .map((file) => file.path),
  );
  const appliedPaths = new Set(recoverable.completedPaths);
  for (const path of eligible) appliedPaths.add(path);

  let currentOperation = snapshotOperation(
    recoverable,
    "restoring",
    recoverable.files
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

  let sawPrewriteConflict = false;
  for (let index = currentOperation.files.length - 1; index >= 0; index -= 1) {
    const file = currentOperation.files[index]!;
    if (!eligible.has(file.path)) continue;
    let updateResult;
    try {
      updateResult = await dependencies.vault.compareAndUpdate(
        file.path,
        file.afterHash,
        file.beforeHash,
        file.inverseEdits,
        dependencies.hashText,
      );
    } catch {
      return restoreFailure(
        currentOperation,
        "restore-write-error",
        dependencies,
      );
    }
    if (updateResult.kind === "stale") {
      sawPrewriteConflict = true;
      continue;
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
  const unsafe =
    sawPrewriteConflict ||
    finalInspection.files.some(
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

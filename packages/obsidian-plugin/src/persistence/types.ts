import type { NumberingPlan, SourceRange } from "@heading-keeper/core";

export type OperationState =
  | "previewed"
  | "applying"
  | "completed"
  | "recovery-required"
  | "restoring"
  | "restored";

export type PlannedFileRole = "target" | "link-source";

export interface PlannedTextEdit {
  readonly range: SourceRange;
  readonly expectedText: string;
  readonly replacementText: string;
}

export interface PlannedFileChange {
  readonly path: string;
  readonly beforeHash: string;
  readonly beforeText: string;
  readonly afterHash: string;
  readonly afterText: string;
  readonly role: PlannedFileRole;
}

export interface PersistedOperation {
  readonly id: string;
  readonly createdAt: string;
  readonly state: OperationState;
  readonly files: readonly PlannedFileChange[];
  readonly completedPaths: readonly string[];
}

export interface VaultFileAdapter {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

export interface JournalStore {
  load(id: string): Promise<PersistedOperation | null>;
  save(operation: PersistedOperation): Promise<void>;
}

export type HashText = (text: string) => Promise<string>;

export interface TargetPlanInput {
  readonly path: string;
  readonly beforeText: string;
  readonly numberingPlan: NumberingPlan;
  readonly numberingMaterialization: "insert" | "validate-only";
  readonly linkEdits: readonly PlannedTextEdit[];
}

export interface LinkSourcePlanInput {
  readonly path: string;
  readonly beforeText: string;
  readonly edits: readonly PlannedTextEdit[];
}

export interface BuildPersistedOperationInput {
  readonly target: TargetPlanInput;
  readonly linkSources: readonly LinkSourcePlanInput[];
}

export interface BuildPersistedOperationDependencies {
  createId(): string;
  now(): string;
  hashText: HashText;
}

export type BuildPersistedOperationResult =
  | { readonly kind: "no-op" }
  | { readonly kind: "operation"; readonly operation: PersistedOperation };

export interface PersistenceDependencies {
  readonly vault: VaultFileAdapter;
  readonly journal: JournalStore;
  readonly hashText: HashText;
}

export type ExecutionResult =
  | { readonly kind: "completed"; readonly operation: PersistedOperation }
  | {
      readonly kind: "stale-plan";
      readonly code: "source-stale";
      readonly path: string;
      readonly operation: PersistedOperation;
    }
  | {
      readonly kind: "recovery-required";
      readonly code: string;
      readonly operation: PersistedOperation;
    }
  | {
      readonly kind: "journal-error";
      readonly code: "journal-error";
      readonly operation: PersistedOperation;
    };

export type RecoveryFileStatus =
  | "eligible"
  | "changed"
  | "restored"
  | "pending";

export interface RecoveryFileInspection {
  readonly path: string;
  readonly role: PlannedFileRole;
  readonly status: RecoveryFileStatus;
}

export interface PersistenceDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface RecoveryInspection {
  readonly kind: "inspected";
  readonly files: readonly RecoveryFileInspection[];
  readonly diagnostics: readonly PersistenceDiagnostic[];
}

export type RestoreResult =
  | { readonly kind: "restored"; readonly operation: PersistedOperation }
  | {
      readonly kind: "recovery-required";
      readonly code: string;
      readonly operation: PersistedOperation;
    }
  | {
      readonly kind: "journal-error";
      readonly code: "journal-error";
      readonly operation: PersistedOperation;
    };

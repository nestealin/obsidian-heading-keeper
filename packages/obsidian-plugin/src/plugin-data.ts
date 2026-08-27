import type { FieldError } from "@heading-keeper/core";
import { snapshotOperation } from "./persistence/journal.js";
import { invertEdits } from "./persistence/edits.js";
import { validatePersistedOperation } from "./persistence/operation-validator.js";
import type {
  HashText,
  JournalStore,
  OperationSummary,
  PersistedOperation,
} from "./persistence/types.js";
import {
  applySummaryRetention,
  DEFAULT_RETENTION_POLICY,
  serializedByteLength,
} from "./persistence/retention.js";
import {
  DEFAULT_STORED_SETTINGS,
  type StoredSettings,
  validateStoredSettings,
} from "./settings.js";

export interface PersistedPluginData {
  readonly settings: StoredSettings;
  readonly journals: Readonly<Record<string, PersistedOperation>>;
  readonly latestJournalId: string | null;
  readonly summaries: readonly OperationSummary[];
}

export interface LoadedPluginData {
  readonly settings: StoredSettings;
  readonly settingsErrors: readonly FieldError[];
  readonly diagnostics: readonly string[];
}

type LoadData = () => Promise<unknown>;
type SaveData = (value: unknown) => Promise<unknown>;

interface CandidateState {
  settings: StoredSettings;
  journals: Map<string, PersistedOperation>;
  latestJournalId: string | null;
  summaries: OperationSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  try {
    return Object.getOwnPropertyDescriptor(value, key) !== undefined;
  } catch {
    return false;
  }
}

function dataSnapshot(
  settings: StoredSettings,
  journals: ReadonlyMap<string, PersistedOperation>,
  latestJournalId: string | null,
  summaries: readonly OperationSummary[],
): PersistedPluginData {
  const storedJournals: Record<string, PersistedOperation> = {};
  for (const [id, operation] of journals) {
    storedJournals[id] = snapshotOperation(operation);
  }
  return {
    settings: { ...settings },
    journals: storedJournals,
    latestJournalId,
    summaries: summaries.map((summary) => ({ ...summary })),
  };
}

export class PluginDataStore {
  private currentSettings: StoredSettings = { ...DEFAULT_STORED_SETTINGS };
  private readonly journals = new Map<string, PersistedOperation>();
  private currentLatestJournalId: string | null = null;
  private currentSummaries: OperationSummary[] = [];
  private saveTail: Promise<void> = Promise.resolve();

  readonly journal: JournalStore = {
    load: async (id) => {
      const operation = this.journals.get(id);
      return operation ? snapshotOperation(operation) : null;
    },
    save: async (operation) => {
      const validation = await validatePersistedOperation(
        operation,
        this.hashText,
        "durable",
      );
      if (!validation.ok) throw new Error("journal-invalid");
      const snapshot = validation.operation;
      await this.enqueueSave((candidate) => {
        if (snapshot.state === "completed" || snapshot.state === "restored") {
          candidate.journals.delete(snapshot.id);
          candidate.summaries = upsertSummary(
            candidate.summaries,
            summarizeOperation(snapshot, this.now()),
          );
          candidate.latestJournalId = latestPendingId(candidate.journals);
        } else {
          candidate.journals.set(snapshot.id, snapshot);
          candidate.latestJournalId = snapshot.id;
        }
      });
    },
    listPending: () => this.recoveryOperations(),
    savePending: async (operation) => this.journal.save(operation),
    complete: async (operation, diagnosticCode) => {
      const final =
        operation.state === "restored"
          ? operation
          : snapshotOperation(
              operation,
              "completed",
              operation.files.map((file) => file.path),
            );
      await this.enqueueSave((candidate) => {
        candidate.journals.delete(final.id);
        candidate.summaries = upsertSummary(
          candidate.summaries,
          summarizeOperation(final, this.now(), diagnosticCode),
        );
        candidate.latestJournalId = latestPendingId(candidate.journals);
      });
    },
    remove: async (id) => {
      await this.enqueueSave((candidate) => {
        candidate.journals.delete(id);
        candidate.latestJournalId = latestPendingId(candidate.journals);
      });
    },
    summaries: () => this.currentSummaries.map((summary) => ({ ...summary })),
  };

  constructor(
    private readonly loadData: LoadData,
    private readonly saveData: SaveData,
    private readonly hashText: HashText,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get settings(): StoredSettings {
    return { ...this.currentSettings };
  }

  get latestJournalId(): string | null {
    return this.currentLatestJournalId;
  }

  async initialize(): Promise<LoadedPluginData> {
    const raw = await this.loadData();
    const diagnostics: string[] = [];
    let needsRewrite = false;
    this.journals.clear();
    this.currentLatestJournalId = null;
    this.currentSummaries = [];

    const envelope =
      isRecord(raw) &&
      ["settings", "journals", "latestJournalId", "summaries"].some((key) =>
        hasOwnKey(raw, key),
      );
    const settingsInput = envelope ? own(raw, "settings") : raw;
    const fresh = raw === null || raw === undefined;
    const settingsValidation = fresh
      ? { ok: true as const, value: { ...DEFAULT_STORED_SETTINGS } }
      : validateStoredSettings(settingsInput);
    const settingsErrors = settingsValidation.ok
      ? []
      : settingsValidation.errors;
    this.currentSettings = settingsValidation.ok
      ? settingsValidation.value
      : { ...DEFAULT_STORED_SETTINGS };

    if (envelope && isRecord(raw)) {
      const rawJournals = own(raw, "journals");
      if (isRecord(rawJournals)) {
        for (const [id, candidate] of Object.entries(rawJournals)) {
          let validation = await validatePersistedOperation(
            candidate as PersistedOperation,
            this.hashText,
            "durable",
          );
          let migrated = false;
          if (!validation.ok) {
            const legacy = await migrateLegacyOperation(
              candidate,
              this.hashText,
            );
            if (legacy) {
              validation = { ok: true, operation: legacy };
              migrated = true;
            }
          }
          if (!validation.ok || validation.operation.id !== id) {
            diagnostics.push("journal-invalid");
            continue;
          }
          if (migrated) diagnostics.push("journal-migrated");
          if (migrated) needsRewrite = true;
          if (
            validation.operation.state === "completed" ||
            validation.operation.state === "restored"
          ) {
            needsRewrite = true;
            this.currentSummaries = upsertSummary(
              this.currentSummaries,
              summarizeOperation(validation.operation, this.now()),
            );
          } else {
            this.journals.set(id, validation.operation);
          }
        }
      } else if (rawJournals !== undefined) {
        diagnostics.push("journal-invalid");
      }
      const requestedLatest = own(raw, "latestJournalId");
      if (
        typeof requestedLatest === "string" &&
        this.journals.has(requestedLatest)
      ) {
        this.currentLatestJournalId = requestedLatest;
      }
      const rawSummaries = own(raw, "summaries");
      if (Array.isArray(rawSummaries)) {
        for (const candidate of rawSummaries) {
          const summary = validSummary(candidate);
          if (summary) this.currentSummaries.push(summary);
          else diagnostics.push("summary-invalid");
        }
        this.currentSummaries = applySummaryRetention(
          this.currentSummaries,
          this.now(),
        );
      } else if (rawSummaries !== undefined) {
        diagnostics.push("summary-invalid");
      }
    }
    if (!this.currentLatestJournalId) {
      this.currentLatestJournalId =
        latestPendingId(this.journals) ??
        [...this.journals.keys()].at(-1) ??
        null;
    }
    if (needsRewrite) await this.enqueueSave(() => undefined);
    return {
      settings: this.settings,
      settingsErrors,
      diagnostics,
    };
  }

  async saveSettings(
    next: unknown,
  ): Promise<
    | { readonly ok: true; readonly settings: StoredSettings }
    | { readonly ok: false; readonly errors: readonly FieldError[] }
  > {
    const validation = validateStoredSettings(next);
    if (!validation.ok) return validation;
    const settings = validation.value;
    await this.enqueueSave((candidate) => {
      candidate.settings = settings;
    });
    return { ok: true, settings: this.settings };
  }

  recoveryOperations(): readonly PersistedOperation[] {
    return [...this.journals.values()]
      .filter((operation) =>
        ["applying", "recovery-required", "restoring"].includes(
          operation.state,
        ),
      )
      .map((operation) => snapshotOperation(operation));
  }

  latestRecoveryOperation(): PersistedOperation | null {
    const pointed = this.currentLatestJournalId
      ? this.journals.get(this.currentLatestJournalId)
      : undefined;
    if (pointed && isRecoverable(pointed)) return snapshotOperation(pointed);
    const fallback = [...this.journals.values()]
      .filter(isRecoverable)
      .sort(
        (left, right) =>
          compareCodeUnits(left.createdAt, right.createdAt) ||
          compareCodeUnits(left.id, right.id),
      )
      .at(-1);
    return fallback ? snapshotOperation(fallback) : null;
  }

  private enqueueSave(
    mutate: (candidate: CandidateState) => void,
  ): Promise<void> {
    const task = this.saveTail.then(async () => {
      const candidate: CandidateState = {
        settings: { ...this.currentSettings },
        journals: new Map(this.journals),
        latestJournalId: this.currentLatestJournalId,
        summaries: this.currentSummaries.map((summary) => ({ ...summary })),
      };
      mutate(candidate);
      candidate.summaries = applySummaryRetention(
        candidate.summaries,
        this.now(),
      );
      const payload = dataSnapshot(
        candidate.settings,
        candidate.journals,
        candidate.latestJournalId,
        candidate.summaries,
      );
      if (serializedByteLength(payload) > DEFAULT_RETENTION_POLICY.maxBytes) {
        throw new Error("storage-limit");
      }
      await this.saveData(payload);
      this.currentSettings = candidate.settings;
      this.journals.clear();
      for (const [id, operation] of candidate.journals) {
        this.journals.set(id, operation);
      }
      this.currentLatestJournalId = candidate.latestJournalId;
      this.currentSummaries = candidate.summaries;
    });
    this.saveTail = task.catch(() => undefined);
    return task;
  }
}

function isRecoverable(operation: PersistedOperation): boolean {
  return ["applying", "recovery-required", "restoring"].includes(
    operation.state,
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function latestPendingId(
  journals: ReadonlyMap<string, PersistedOperation>,
): string | null {
  return (
    [...journals.values()]
      .filter(isRecoverable)
      .sort(
        (left, right) =>
          compareCodeUnits(left.createdAt, right.createdAt) ||
          compareCodeUnits(left.id, right.id),
      )
      .at(-1)?.id ?? null
  );
}

function summarizeOperation(
  operation: PersistedOperation,
  completedAtMs: number,
  diagnosticCode: string | null = null,
): OperationSummary {
  return {
    id: operation.id,
    createdAt: operation.createdAt,
    completedAt: new Date(completedAtMs).toISOString(),
    state: operation.state === "restored" ? "restored" : "completed",
    fileCount: operation.files.length,
    editCount: operation.files.reduce(
      (count, file) => count + file.edits.length,
      0,
    ),
    diagnosticCode,
  };
}

function upsertSummary(
  summaries: readonly OperationSummary[],
  summary: OperationSummary,
): OperationSummary[] {
  return [
    ...summaries.filter((candidate) => candidate.id !== summary.id),
    summary,
  ];
}

function validSummary(value: unknown): OperationSummary | null {
  if (!isRecord(value)) return null;
  const id = own(value, "id");
  const createdAt = own(value, "createdAt");
  const completedAt = own(value, "completedAt");
  const state = own(value, "state");
  const fileCount = own(value, "fileCount");
  const editCount = own(value, "editCount");
  const diagnosticCode = own(value, "diagnosticCode");
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof createdAt !== "string" ||
    !Number.isFinite(Date.parse(createdAt)) ||
    typeof completedAt !== "string" ||
    !Number.isFinite(Date.parse(completedAt)) ||
    (state !== "completed" && state !== "restored") ||
    !Number.isSafeInteger(fileCount) ||
    (fileCount as number) < 0 ||
    !Number.isSafeInteger(editCount) ||
    (editCount as number) < 0 ||
    (diagnosticCode !== null && typeof diagnosticCode !== "string")
  ) {
    return null;
  }
  return {
    id,
    createdAt,
    completedAt,
    state,
    fileCount: fileCount as number,
    editCount: editCount as number,
    diagnosticCode,
  };
}

async function migrateLegacyOperation(
  value: unknown,
  hashText: HashText,
): Promise<PersistedOperation | null> {
  if (!isRecord(value)) return null;
  const id = own(value, "id");
  const createdAt = own(value, "createdAt");
  const state = own(value, "state");
  const files = own(value, "files");
  const completedPaths = own(value, "completedPaths");
  if (
    typeof id !== "string" ||
    typeof createdAt !== "string" ||
    typeof state !== "string" ||
    !Array.isArray(files) ||
    !Array.isArray(completedPaths) ||
    !completedPaths.every((path) => typeof path === "string")
  ) {
    return null;
  }
  const migratedFiles = [];
  try {
    for (const file of files) {
      if (!isRecord(file)) return null;
      const path = own(file, "path");
      const beforeText = own(file, "beforeText");
      const beforeHash = own(file, "beforeHash");
      const afterText = own(file, "afterText");
      const afterHash = own(file, "afterHash");
      const role = own(file, "role");
      if (
        typeof path !== "string" ||
        typeof beforeText !== "string" ||
        typeof beforeHash !== "string" ||
        typeof afterText !== "string" ||
        typeof afterHash !== "string" ||
        (role !== "target" && role !== "link-source") ||
        (await hashText(beforeText)) !== beforeHash ||
        (await hashText(afterText)) !== afterHash
      ) {
        return null;
      }
      const edit = minimalReplacement(beforeText, afterText);
      if (!edit) return null;
      const edits = [edit];
      migratedFiles.push({
        path,
        beforeHash,
        afterHash,
        edits,
        inverseEdits: invertEdits(beforeText, edits),
        role,
      });
    }
  } catch {
    return null;
  }
  const migrated = {
    id,
    createdAt,
    state,
    files: migratedFiles,
    completedPaths,
  } as PersistedOperation;
  const validation = await validatePersistedOperation(
    migrated,
    hashText,
    "durable",
  );
  return validation.ok ? validation.operation : null;
}

function minimalReplacement(beforeText: string, afterText: string) {
  let prefix = 0;
  while (
    prefix < beforeText.length &&
    prefix < afterText.length &&
    beforeText[prefix] === afterText[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeText.length - prefix &&
    suffix < afterText.length - prefix &&
    beforeText[beforeText.length - 1 - suffix] ===
      afterText[afterText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const beforeEnd = beforeText.length - suffix;
  const afterEnd = afterText.length - suffix;
  const expectedText = beforeText.slice(prefix, beforeEnd);
  const replacementText = afterText.slice(prefix, afterEnd);
  if (expectedText === replacementText) return null;
  return {
    range: { from: prefix, to: beforeEnd },
    expectedText,
    replacementText,
  };
}

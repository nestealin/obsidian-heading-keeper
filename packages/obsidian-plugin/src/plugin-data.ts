import type { FieldError } from "@heading-keeper/core";
import { snapshotOperation } from "./persistence/journal.js";
import { validatePersistedOperation } from "./persistence/operation-validator.js";
import type {
  HashText,
  JournalStore,
  PersistedOperation,
} from "./persistence/types.js";
import {
  DEFAULT_STORED_SETTINGS,
  type StoredSettings,
  validateStoredSettings,
} from "./settings.js";

export interface PersistedPluginData {
  readonly settings: StoredSettings;
  readonly journals: Readonly<Record<string, PersistedOperation>>;
  readonly latestJournalId: string | null;
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
): PersistedPluginData {
  const storedJournals: Record<string, PersistedOperation> = {};
  for (const [id, operation] of journals) {
    storedJournals[id] = snapshotOperation(operation);
  }
  return {
    settings: { ...settings },
    journals: storedJournals,
    latestJournalId,
  };
}

export class PluginDataStore {
  private currentSettings: StoredSettings = { ...DEFAULT_STORED_SETTINGS };
  private readonly journals = new Map<string, PersistedOperation>();
  private currentLatestJournalId: string | null = null;
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
        candidate.journals.set(snapshot.id, snapshot);
        candidate.latestJournalId = snapshot.id;
      });
    },
  };

  constructor(
    private readonly loadData: LoadData,
    private readonly saveData: SaveData,
    private readonly hashText: HashText,
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
    this.journals.clear();
    this.currentLatestJournalId = null;

    const envelope =
      isRecord(raw) &&
      ["settings", "journals", "latestJournalId"].some((key) =>
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
          const validation = await validatePersistedOperation(
            candidate as PersistedOperation,
            this.hashText,
            "durable",
          );
          if (!validation.ok || validation.operation.id !== id) {
            diagnostics.push("journal-invalid");
            continue;
          }
          this.journals.set(id, validation.operation);
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
    }
    if (!this.currentLatestJournalId) {
      this.currentLatestJournalId = [...this.journals.keys()].at(-1) ?? null;
    }
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
      };
      mutate(candidate);
      await this.saveData(
        dataSnapshot(
          candidate.settings,
          candidate.journals,
          candidate.latestJournalId,
        ),
      );
      this.currentSettings = candidate.settings;
      this.journals.clear();
      for (const [id, operation] of candidate.journals) {
        this.journals.set(id, operation);
      }
      this.currentLatestJournalId = candidate.latestJournalId;
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

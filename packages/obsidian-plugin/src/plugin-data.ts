import type { FieldError } from "@heading-numbering/core";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
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
      await this.enqueueSave(() => {
        this.journals.set(snapshot.id, snapshot);
        this.currentLatestJournalId = snapshot.id;
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

    const envelope = isRecord(raw) && isRecord(own(raw, "settings"));
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
    await this.enqueueSave(() => {
      this.currentSettings = settings;
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

  private enqueueSave(mutate: () => void): Promise<void> {
    const task = this.saveTail.then(async () => {
      mutate();
      await this.saveData(
        dataSnapshot(
          this.currentSettings,
          this.journals,
          this.currentLatestJournalId,
        ),
      );
    });
    this.saveTail = task.catch(() => undefined);
    return task;
  }
}

import { scanHeadings } from "@heading-keeper/core";
import {
  normalizeHeadingFragment,
  type HeadingRename,
  type ResolvedTarget,
} from "@heading-keeper/link-core";
import { buildRenameOnlyOperation } from "./persisted-workflow.js";
import type { HeadingRenameIntent } from "./plugin-data.js";
import { snapshotOperation } from "./persistence/journal.js";
import type {
  BuildPersistedOperationDependencies,
  ExecutionResult,
  JournalStore,
  PersistedOperation,
} from "./persistence/types.js";
import type { StoredSettings } from "./settings.js";

export type MaintenanceReason = "file-open" | "modify" | "metadata";

export type AutomaticExecutionResult =
  | ExecutionResult
  | { readonly kind: "busy" };

export interface AutomaticMaintenanceDependencies {
  readonly settings: () => StoredSettings;
  readonly read: (path: string) => Promise<string>;
  readonly indexReady: () => boolean;
  readonly candidates: (
    targetPath: string,
    fragments: readonly string[],
  ) => readonly string[];
  readonly resolveTarget: (
    sourcePath: string,
    linkPath: string,
  ) => ResolvedTarget;
  readonly operationDependencies: BuildPersistedOperationDependencies;
  readonly journal: JournalStore;
  readonly renameIntents?: {
    readonly list: (targetPath?: string) => readonly HeadingRenameIntent[];
    readonly stage?: (intent: HeadingRenameIntent) => Promise<void>;
    readonly remove: (ids: readonly string[]) => Promise<void>;
  };
  readonly execute: (
    operation: PersistedOperation,
  ) => Promise<AutomaticExecutionResult>;
  readonly now: () => number;
  readonly debounceMs?: number;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly onConflict?: (operation: PersistedOperation, code: string) => void;
  readonly onStorageError?: (code: string) => void;
}

const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;

export class AutomaticMaintenance {
  private readonly pendingPaths = new Set<string>();
  private readonly pathTimers = new Map<string, unknown>();
  private readonly retryTimers = new Map<string, unknown>();
  private readonly additionalRenames = new Map<string, HeadingRename[]>();
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private readonly dependencies: AutomaticMaintenanceDependencies,
  ) {}

  schedule(path: string, _reason: MaintenanceReason): void {
    if (this.disposed) return;
    this.pendingPaths.add(path);
    const previous = this.pathTimers.get(path);
    if (previous !== undefined) this.clearTimer(previous);
    const timer = this.setTimer(() => {
      this.pathTimers.delete(path);
      void this.enqueuePath(path);
    }, this.dependencies.debounceMs ?? 350);
    this.pathTimers.set(path, timer);
  }

  async acceptMetadataChange(
    path: string,
    before: readonly string[],
    after: readonly string[],
  ): Promise<void> {
    const rename = uniqueHeadingRename(path, before, after);
    if (!rename) return;
    const stored = this.dependencies.renameIntents;
    if (
      stored
        ?.list(path)
        .some((intent) =>
          intent.renames.some(
            (candidate) =>
              candidate.oldHeading === rename.oldHeading &&
              candidate.newHeading === rename.newHeading,
          ),
        )
    ) {
      this.schedule(path, "metadata");
      return;
    }
    if (stored?.stage) {
      try {
        await stored.stage({
          id: this.dependencies.operationDependencies.createId(),
          createdAt: this.dependencies.operationDependencies.now(),
          targetPath: path,
          renames: [rename],
        });
        this.schedule(path, "metadata");
        return;
      } catch {
        this.dependencies.onStorageError?.("rename-intent-storage");
      }
    }
    this.additionalRenames.set(path, [rename]);
    this.schedule(path, "metadata");
  }

  async flush(): Promise<void> {
    for (const timer of this.pathTimers.values()) this.clearTimer(timer);
    this.pathTimers.clear();
    const paths = [...this.pendingPaths].sort(compareCodeUnits);
    this.pendingPaths.clear();
    for (const path of paths) await this.enqueuePath(path);
    await this.tail;
  }

  async resume(): Promise<void> {
    const operations = [...this.dependencies.journal.listPending()].sort(
      (left, right) =>
        compareCodeUnits(left.createdAt, right.createdAt) ||
        compareCodeUnits(left.id, right.id),
    );
    for (const operation of operations) {
      const nextAt = operation.retry
        ? Date.parse(operation.retry.nextAttemptAt)
        : this.dependencies.now();
      if (nextAt > this.dependencies.now()) {
        this.armOperationRetry(operation, nextAt - this.dependencies.now());
      } else {
        await this.enqueueOperation(operation);
      }
    }
    const intentPaths = [
      ...new Set(
        (this.dependencies.renameIntents?.list() ?? []).map(
          (intent) => intent.targetPath,
        ),
      ),
    ].sort(compareCodeUnits);
    for (const path of intentPaths) await this.enqueuePath(path);
    await this.tail;
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.pathTimers.values()) this.clearTimer(timer);
    for (const timer of this.retryTimers.values()) this.clearTimer(timer);
    this.pathTimers.clear();
    this.retryTimers.clear();
    this.pendingPaths.clear();
    this.additionalRenames.clear();
  }

  private enqueuePath(path: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.pendingPaths.delete(path);
    this.tail = this.tail.then(() => this.processPath(path));
    return this.tail;
  }

  private enqueueOperation(operation: PersistedOperation): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.tail = this.tail.then(async () => {
      await this.execute(operation);
    });
    return this.tail;
  }

  private async processPath(path: string): Promise<void> {
    if (this.disposed) return;
    const settings = this.dependencies.settings();
    if (settings.mode !== "persisted") return;

    let targetText: string;
    try {
      targetText = await this.dependencies.read(path);
    } catch {
      this.schedule(path, "modify");
      return;
    }
    const intents = this.dependencies.renameIntents?.list(path) ?? [];
    const realized = realizedRenameIntents(targetText, intents);
    const extra = [
      ...(this.additionalRenames.get(path) ?? []),
      ...(realized?.renames ?? []),
    ];
    if (extra.length === 0) return;
    const oldFragments = extra.map((rename) => rename.oldHeading);
    if (
      settings.updateHeadingLinks &&
      oldFragments.length > 0 &&
      !this.dependencies.indexReady()
    ) {
      this.schedule(path, "metadata");
      return;
    }

    const candidatePaths = settings.updateHeadingLinks
      ? [...this.dependencies.candidates(path, oldFragments)]
          .filter((candidate) => candidate !== path)
          .sort(compareCodeUnits)
      : [];
    const sources = [{ path, text: targetText }];
    try {
      for (const candidate of candidatePaths) {
        sources.push({
          path: candidate,
          text: await this.dependencies.read(candidate),
        });
      }
    } catch {
      this.schedule(path, "modify");
      return;
    }

    let preview;
    try {
      preview = await buildRenameOnlyOperation(
        {
          targetPath: path,
          sources,
          resolveTarget: this.dependencies.resolveTarget,
          renames: extra,
        },
        this.dependencies.operationDependencies,
      );
    } catch {
      this.schedule(path, "modify");
      return;
    }
    this.additionalRenames.delete(path);
    if (preview.kind === "no-op") {
      if (realized && realized.intentIds.length > 0) {
        await this.dependencies.renameIntents?.remove(realized.intentIds);
      }
      return;
    }
    const outcome = await this.execute(preview.operation, path);
    if (outcome === "completed" && realized && realized.intentIds.length > 0) {
      await this.dependencies.renameIntents?.remove(realized.intentIds);
    }
  }

  private async execute(
    operation: PersistedOperation,
    retryPath?: string,
  ): Promise<"completed" | "conflict" | "deferred"> {
    if (this.disposed) return "deferred";
    let result: AutomaticExecutionResult;
    try {
      result = await this.dependencies.execute(operation);
    } catch {
      await this.retry(operation, "execute-error");
      return "deferred";
    }
    if (result.kind === "completed") {
      const timer = this.retryTimers.get(operation.id);
      if (timer !== undefined) this.clearTimer(timer);
      this.retryTimers.delete(operation.id);
      await this.dependencies.journal.complete(result.operation);
      return "completed";
    }
    if (result.kind === "stale-plan") {
      this.dependencies.onConflict?.(result.operation, result.code);
      return "conflict";
    }
    if (result.kind === "recovery-required") {
      if (isStructuralConflict(result.code)) {
        this.dependencies.onConflict?.(result.operation, result.code);
        return "conflict";
      }
      await this.retry(result.operation, result.code);
      return "deferred";
    }
    if (result.kind === "busy" && retryPath !== undefined) {
      this.schedule(retryPath, "modify");
      return "deferred";
    }
    await this.retry(
      result.kind === "journal-error" ? result.operation : operation,
      result.kind === "journal-error" ? result.code : "busy",
    );
    return "deferred";
  }

  private async retry(
    operation: PersistedOperation,
    diagnosticCode: string,
  ): Promise<void> {
    const attempts = (operation.retry?.attempts ?? 0) + 1;
    const delay = Math.min(1_000 * 2 ** (attempts - 1), MAX_RETRY_DELAY_MS);
    const retry = snapshotOperation({
      ...operation,
      state:
        operation.state === "previewed" ? "previewed" : "recovery-required",
      retry: {
        attempts,
        nextAttemptAt: new Date(this.dependencies.now() + delay).toISOString(),
        diagnosticCode,
      },
    });
    try {
      await this.dependencies.journal.savePending(retry);
    } catch {
      this.dependencies.onConflict?.(retry, "storage-limit");
      return;
    }
    this.armOperationRetry(retry, delay);
  }

  private armOperationRetry(
    operation: PersistedOperation,
    delayMs: number,
  ): void {
    const previous = this.retryTimers.get(operation.id);
    if (previous !== undefined) this.clearTimer(previous);
    const timer = this.setTimer(
      () => {
        this.retryTimers.delete(operation.id);
        void this.enqueueOperation(operation);
      },
      Math.min(delayMs, MAX_RETRY_DELAY_MS),
    );
    this.retryTimers.set(operation.id, timer);
  }

  private setTimer(callback: () => void, delayMs: number): unknown {
    return this.dependencies.setTimer
      ? this.dependencies.setTimer(callback, delayMs)
      : setTimeout(callback, delayMs);
  }

  private clearTimer(handle: unknown): void {
    if (this.dependencies.clearTimer) this.dependencies.clearTimer(handle);
    else clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
}

function uniqueHeadingRename(
  targetPath: string,
  before: readonly string[],
  after: readonly string[],
): HeadingRename | null {
  if (before.length !== after.length) return null;
  const changed = before.flatMap((heading, index) =>
    heading === after[index]
      ? []
      : [{ oldHeading: heading, newHeading: after[index] ?? "" }],
  );
  return changed.length === 1 && changed[0]!.newHeading.length > 0
    ? { targetPath, ...changed[0]! }
    : null;
}

function isStructuralConflict(code: string): boolean {
  return [
    "operation-invalid",
    "operation-conflict",
    "recovery-conflict",
  ].includes(code);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function realizedRenameIntents(
  markdown: string,
  intents: readonly HeadingRenameIntent[],
): {
  readonly intentIds: readonly string[];
  readonly renames: readonly HeadingRename[];
} | null {
  if (intents.length === 0) return null;
  const renames = collapseRenames(intents.flatMap((intent) => intent.renames));
  if (renames.length === 0) return null;
  const counts = new Map<string, number>();
  for (const heading of scanHeadings(markdown)) {
    const normalized = normalizeHeadingFragment(heading.rawText.trim());
    if (normalized.ok) {
      counts.set(normalized.value, (counts.get(normalized.value) ?? 0) + 1);
    }
  }
  for (const rename of renames) {
    const oldHeading = normalizeHeadingFragment(rename.oldHeading);
    const newHeading = normalizeHeadingFragment(rename.newHeading);
    if (
      !oldHeading.ok ||
      !newHeading.ok ||
      (counts.get(oldHeading.value) ?? 0) !== 0 ||
      (counts.get(newHeading.value) ?? 0) !== 1
    ) {
      return null;
    }
  }
  return {
    intentIds: intents.map((intent) => intent.id),
    renames,
  };
}

function collapseRenames(renames: readonly HeadingRename[]): HeadingRename[] {
  const collapsed: HeadingRename[] = [];
  for (const rename of renames) {
    const oldHeading = normalizeHeadingFragment(rename.oldHeading);
    if (!oldHeading.ok) continue;
    const previous = collapsed.find((candidate) => {
      const current = normalizeHeadingFragment(candidate.newHeading);
      return (
        candidate.targetPath === rename.targetPath &&
        current.ok &&
        current.value === oldHeading.value
      );
    });
    if (previous) {
      previous.newHeading = rename.newHeading;
      continue;
    }
    const sameOrigin = collapsed.find((candidate) => {
      const origin = normalizeHeadingFragment(candidate.oldHeading);
      return (
        candidate.targetPath === rename.targetPath &&
        origin.ok &&
        origin.value === oldHeading.value
      );
    });
    if (sameOrigin) sameOrigin.newHeading = rename.newHeading;
    else collapsed.push({ ...rename });
  }
  return collapsed.filter((rename) => {
    const oldHeading = normalizeHeadingFragment(rename.oldHeading);
    const newHeading = normalizeHeadingFragment(rename.newHeading);
    return (
      !oldHeading.ok || !newHeading.ok || oldHeading.value !== newHeading.value
    );
  });
}

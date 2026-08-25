import {
  detectSafeHeadingRename,
  type UnsafeHeadingRenameReason,
} from "@heading-keeper/core";
import {
  planRenameScopedLinkChanges,
  type HeadingRename,
  type LinkDiagnosticCode,
  type ResolvedTarget,
} from "@heading-keeper/link-core";
import { buildLinkOnlyOperation } from "./persistence/plan-service.js";
import type {
  BuildPersistedOperationDependencies,
  ExecutionResult,
  PersistedOperation,
} from "./persistence/types.js";

export interface HeadingLinkSyncSource {
  readonly path: string;
  readonly text: string;
}

export interface AutomaticHeadingLinkSyncInput {
  readonly targetPath: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly sources: readonly HeadingLinkSyncSource[];
  readonly resolveTarget: (
    sourcePath: string,
    linkPath: string,
  ) => ResolvedTarget;
}

export interface HeadingLinkSyncDiagnostic {
  readonly path: string;
  readonly code: LinkDiagnosticCode;
}

export type AutomaticHeadingLinkSyncResult =
  | { readonly kind: "unsafe"; readonly reason: UnsafeHeadingRenameReason }
  | {
      readonly kind: "no-op";
      readonly rename: HeadingRename;
      readonly diagnostics: readonly HeadingLinkSyncDiagnostic[];
    }
  | {
      readonly kind: "operation";
      readonly rename: HeadingRename;
      readonly operation: PersistedOperation;
      readonly diagnostics: readonly HeadingLinkSyncDiagnostic[];
    };

export async function buildAutomaticHeadingLinkSync(
  input: AutomaticHeadingLinkSyncInput,
  dependencies: BuildPersistedOperationDependencies,
): Promise<AutomaticHeadingLinkSyncResult> {
  const detected = detectSafeHeadingRename(input.beforeText, input.afterText);
  if (detected.kind !== "safe") {
    return { kind: "unsafe", reason: detected.reason };
  }

  const rename: HeadingRename = {
    targetPath: input.targetPath,
    ...detected.rename,
  };
  const diagnostics: HeadingLinkSyncDiagnostic[] = [];
  const linkSources = [...input.sources]
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )
    .map((source) => {
      const plan = planRenameScopedLinkChanges({
        sourcePath: source.path,
        markdown: source.text,
        renames: [rename],
        resolveTarget: input.resolveTarget,
      });
      diagnostics.push(
        ...plan.diagnostics.map((item) => ({
          path: source.path,
          code: item.code,
        })),
      );
      return {
        path: source.path,
        beforeText: source.text,
        edits: plan.edits.map((edit) => ({
          range: edit.range,
          expectedText: source.text.slice(edit.range.from, edit.range.to),
          replacementText: edit.replacement,
        })),
      };
    });

  const built = await buildLinkOnlyOperation({ linkSources }, dependencies);
  return built.kind === "no-op"
    ? { kind: "no-op", rename, diagnostics }
    : { kind: "operation", rename, operation: built.operation, diagnostics };
}

export type SavedHeadingLinkSyncExecution =
  | ExecutionResult
  | { readonly kind: "busy" };

export interface SavedHeadingLinkSyncDependencies {
  readonly enabled: () => boolean;
  readonly listMarkdownPaths: () => readonly string[];
  readonly read: (path: string) => Promise<string>;
  readonly resolveTarget: AutomaticHeadingLinkSyncInput["resolveTarget"];
  readonly operationDependencies: BuildPersistedOperationDependencies;
  readonly execute: (
    operation: PersistedOperation,
  ) => Promise<SavedHeadingLinkSyncExecution>;
}

export type SavedHeadingLinkSyncResult =
  | SavedHeadingLinkSyncExecution
  | { readonly kind: "disabled" }
  | { readonly kind: "disposed" }
  | { readonly kind: "first-snapshot" }
  | Extract<AutomaticHeadingLinkSyncResult, { kind: "unsafe" | "no-op" }>;

export class SavedHeadingLinkSync {
  private readonly snapshots = new Map<string, string>();
  private disposed = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly dependencies: SavedHeadingLinkSyncDependencies,
  ) {}

  async initialize(): Promise<void> {
    const paths = [...this.dependencies.listMarkdownPaths()].sort(
      (left, right) => (left < right ? -1 : left > right ? 1 : 0),
    );
    const snapshots = await Promise.all(
      paths.map(
        async (path) => [path, await this.dependencies.read(path)] as const,
      ),
    );
    if (this.disposed) return;
    for (const [path, text] of snapshots) this.snapshots.set(path, text);
  }

  handleModify(path: string): Promise<SavedHeadingLinkSyncResult> {
    if (this.disposed) return Promise.resolve({ kind: "disposed" });
    const task = this.tail.then(() => this.processModify(path));
    this.tail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  handleRename(oldPath: string, newPath: string): void {
    const text = this.snapshots.get(oldPath);
    this.snapshots.delete(oldPath);
    if (text !== undefined) this.snapshots.set(newPath, text);
  }

  handleDelete(path: string): void {
    this.snapshots.delete(path);
  }

  snapshot(path: string): string | undefined {
    return this.snapshots.get(path);
  }

  acceptCompleted(operation: PersistedOperation): void {
    if (operation.state !== "completed") return;
    for (const file of operation.files) {
      this.snapshots.set(file.path, file.afterText);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.snapshots.clear();
  }

  private async processModify(
    path: string,
  ): Promise<SavedHeadingLinkSyncResult> {
    if (this.disposed) return { kind: "disposed" };
    const afterText = await this.dependencies.read(path);
    if (this.disposed) return { kind: "disposed" };
    const beforeText = this.snapshots.get(path);
    this.snapshots.set(path, afterText);
    if (beforeText === undefined) return { kind: "first-snapshot" };
    if (!this.dependencies.enabled()) return { kind: "disabled" };
    const detected = detectSafeHeadingRename(beforeText, afterText);
    if (detected.kind !== "safe") {
      return { kind: "unsafe", reason: detected.reason };
    }

    const sources = await Promise.all(
      [...this.dependencies.listMarkdownPaths()]
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        .map(async (sourcePath) => ({
          path: sourcePath,
          text:
            sourcePath === path
              ? afterText
              : await this.dependencies.read(sourcePath),
        })),
    );
    if (this.disposed) return { kind: "disposed" };
    const built = await buildAutomaticHeadingLinkSync(
      {
        targetPath: path,
        beforeText,
        afterText,
        sources,
        resolveTarget: this.dependencies.resolveTarget,
      },
      this.dependencies.operationDependencies,
    );
    if (built.kind !== "operation") return built;

    const result = await this.dependencies.execute(built.operation);
    if (result.kind === "completed") {
      this.acceptCompleted(result.operation);
    }
    return result;
  }
}

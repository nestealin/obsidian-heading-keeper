import {
  TFile,
  type CachedMetadata,
  type MetadataCache,
  type Vault,
} from "obsidian";
import {
  normalizeHeadingFragment,
  type ResolvedTarget,
} from "@heading-keeper/link-core";
import type {
  HashText,
  PlannedTextEdit,
  VaultFileAdapter,
} from "./persistence/types.js";
import { applyCheckedEdits } from "./persistence/edits.js";
import {
  ReverseHeadingLinkIndex,
  type HeadingLinkRecord,
} from "./link-index.js";

type VaultSurface = Pick<Vault, "getAbstractFileByPath" | "process" | "read">;

type MetadataSurface = Pick<MetadataCache, "getFirstLinkpathDest">;
type MetadataIndexSurface = Pick<
  MetadataCache,
  "getFileCache" | "getFirstLinkpathDest"
>;
type MarkdownFilesSurface = Pick<Vault, "getMarkdownFiles">;

export class ObsidianVaultFileAdapter implements VaultFileAdapter {
  constructor(private readonly vault: VaultSurface) {}

  async read(path: string): Promise<string> {
    return this.vault.read(this.existingFile(path));
  }

  async compareAndUpdate(
    path: string,
    expectedHash: string,
    resultingHash: string,
    edits: readonly PlannedTextEdit[],
    hashText: HashText,
  ) {
    const file = this.existingFile(path);
    const snapshot = await this.vault.read(file);
    const currentHash = await hashText(snapshot);
    if (currentHash === resultingHash) {
      return { kind: "already-applied" } as const;
    }
    if (currentHash !== expectedHash) return { kind: "stale" } as const;
    const updated = applyCheckedEdits(snapshot, edits);
    if ((await hashText(updated)) !== resultingHash) {
      throw new Error("result-hash-mismatch");
    }
    let stale = false;
    const result = await this.vault.process(file, (current) => {
      if (current !== snapshot) {
        stale = true;
        return current;
      }
      return updated;
    });
    if (stale) return { kind: "stale" } as const;
    if ((await hashText(result)) !== resultingHash) {
      throw new Error("readback-mismatch");
    }
    return { kind: "updated" } as const;
  }

  private existingFile(path: string): TFile {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("vault-file-missing");
    return file;
  }
}

export function createObsidianLinkResolver(
  metadataCache: MetadataSurface,
): (sourcePath: string, linkPath: string) => ResolvedTarget {
  return (sourcePath, linkPath) => {
    if (linkPath === "") return { kind: "file", path: sourcePath };
    const file = metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    return file instanceof TFile
      ? { kind: "file", path: file.path }
      : { kind: "missing" };
  };
}

export interface MetadataLinkDiagnostic {
  readonly sourcePath: string;
  readonly link: string;
  readonly code:
    | "missing-heading-fragment"
    | "malformed-fragment"
    | "block-reference"
    | "target-missing";
}

export function extractObsidianHeadingLinkRecords(
  file: TFile,
  cache: CachedMetadata,
  metadataCache: MetadataIndexSurface,
): {
  readonly records: readonly HeadingLinkRecord[];
  readonly diagnostics: readonly MetadataLinkDiagnostic[];
} {
  const records: HeadingLinkRecord[] = [];
  const diagnostics: MetadataLinkDiagnostic[] = [];
  for (const [kind, references] of [
    ["link", cache.links ?? []],
    ["embed", cache.embeds ?? []],
  ] as const) {
    for (const reference of references) {
      const hash = reference.link.indexOf("#");
      if (hash < 0) {
        continue;
      }
      const linkPath = reference.link.slice(0, hash);
      const rawFragment = reference.link.slice(hash + 1);
      const fragment = normalizeHeadingFragment(rawFragment);
      if (!fragment.ok) {
        diagnostics.push({
          sourcePath: file.path,
          link: reference.link,
          code: "malformed-fragment",
        });
        continue;
      }
      if (fragment.value.startsWith("^")) {
        diagnostics.push({
          sourcePath: file.path,
          link: reference.link,
          code: "block-reference",
        });
        continue;
      }
      const target =
        linkPath === ""
          ? file
          : metadataCache.getFirstLinkpathDest(linkPath, file.path);
      if (!(target instanceof TFile)) {
        diagnostics.push({
          sourcePath: file.path,
          link: reference.link,
          code: "target-missing",
        });
        continue;
      }
      records.push({
        sourcePath: file.path,
        targetPath: target.path,
        fragment: fragment.value,
        kind,
      });
    }
  }
  return { records, diagnostics };
}

export class ObsidianMetadataLinkIndex {
  private readonly index = new ReverseHeadingLinkIndex();
  private ready = false;
  private currentDiagnostics: MetadataLinkDiagnostic[] = [];

  constructor(
    private readonly vault: MarkdownFilesSurface,
    private readonly metadataCache: MetadataIndexSurface,
  ) {}

  get isReady(): boolean {
    return this.ready;
  }

  get diagnostics(): readonly MetadataLinkDiagnostic[] {
    return this.currentDiagnostics.map((diagnostic) => ({ ...diagnostic }));
  }

  rebuild(): void {
    const records: HeadingLinkRecord[] = [];
    const diagnostics: MetadataLinkDiagnostic[] = [];
    let ready = true;
    for (const file of this.vault.getMarkdownFiles()) {
      const cache = this.metadataCache.getFileCache(file);
      if (!cache) {
        ready = false;
        continue;
      }
      const extracted = extractObsidianHeadingLinkRecords(
        file,
        cache,
        this.metadataCache,
      );
      records.push(...extracted.records);
      diagnostics.push(...extracted.diagnostics);
    }
    this.index.rebuild(records);
    this.currentDiagnostics = diagnostics;
    this.ready = ready;
  }

  update(file: TFile, cache: CachedMetadata): void {
    const extracted = extractObsidianHeadingLinkRecords(
      file,
      cache,
      this.metadataCache,
    );
    this.index.deleteSource(file.path);
    if (extracted.records.length > 0) {
      this.index.updateSource(extracted.records);
    }
    this.currentDiagnostics = [
      ...this.currentDiagnostics.filter(
        (diagnostic) => diagnostic.sourcePath !== file.path,
      ),
      ...extracted.diagnostics,
    ];
  }

  renameSource(oldPath: string, newPath: string): void {
    this.index.renameSource(oldPath, newPath);
    this.currentDiagnostics = this.currentDiagnostics.map((diagnostic) =>
      diagnostic.sourcePath === oldPath
        ? { ...diagnostic, sourcePath: newPath }
        : diagnostic,
    );
  }

  deleteSource(path: string): void {
    this.index.deleteSource(path);
    this.currentDiagnostics = this.currentDiagnostics.filter(
      (diagnostic) => diagnostic.sourcePath !== path,
    );
  }

  candidates(targetPath: string, fragments: readonly string[]): string[] {
    if (!this.ready) return [];
    return this.index.candidates(targetPath, fragments);
  }

  dispose(): void {
    this.index.rebuild([]);
    this.currentDiagnostics = [];
    this.ready = false;
  }
}

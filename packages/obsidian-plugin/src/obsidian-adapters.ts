import { TFile, type MetadataCache, type Vault } from "obsidian";
import type { ResolvedTarget } from "@heading-keeper/link-core";
import type {
  HashText,
  PlannedTextEdit,
  VaultFileAdapter,
} from "./persistence/types.js";
import { applyCheckedEdits } from "./persistence/edits.js";

type VaultSurface = Pick<Vault, "getAbstractFileByPath" | "process" | "read">;

type MetadataSurface = Pick<MetadataCache, "getFirstLinkpathDest">;

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

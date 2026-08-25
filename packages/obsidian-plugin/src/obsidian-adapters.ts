import { TFile, type MetadataCache, type Vault } from "obsidian";
import type { ResolvedTarget } from "@heading-keeper/link-core";
import type { VaultFileAdapter } from "./persistence/types.js";

type VaultSurface = Pick<Vault, "getAbstractFileByPath" | "modify" | "read">;

type MetadataSurface = Pick<MetadataCache, "getFirstLinkpathDest">;

export class ObsidianVaultFileAdapter implements VaultFileAdapter {
  constructor(private readonly vault: VaultSurface) {}

  async read(path: string): Promise<string> {
    return this.vault.read(this.existingFile(path));
  }

  async write(path: string, text: string): Promise<void> {
    await this.vault.modify(this.existingFile(path), text);
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

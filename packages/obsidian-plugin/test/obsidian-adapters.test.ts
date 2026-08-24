import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ modified: [] as Array<[string, string]> }));

vi.mock("obsidian", () => ({
  TFile: class TFile {
    extension: string;
    constructor(readonly path: string) {
      this.extension = path.endsWith(".md") ? "md" : "txt";
    }
  },
}));

import { TFile } from "obsidian";
import {
  createObsidianLinkResolver,
  ObsidianVaultFileAdapter,
} from "../src/obsidian-adapters.js";

beforeEach(() => (state.modified.length = 0));

describe("Obsidian adapters", () => {
  it("reads and modifies existing TFiles without creating missing files", async () => {
    const files = new Map([["A.md", new TFile("A.md")]]);
    const adapter = new ObsidianVaultFileAdapter({
      getAbstractFileByPath: (path) => files.get(path) ?? null,
      read: async (file) => `text:${file.path}`,
      modify: async (file, text) => state.modified.push([file.path, text]),
    });

    await expect(adapter.read("A.md")).resolves.toBe("text:A.md");
    await adapter.write("A.md", "changed");
    await expect(adapter.write("Missing.md", "x")).rejects.toThrow(
      "vault-file-missing",
    );
    expect(state.modified).toEqual([["A.md", "changed"]]);
  });

  it("resolves file identity only through getFirstLinkpathDest", () => {
    const calls: Array<[string, string]> = [];
    const target = new TFile("Folder/Target.md");
    const resolver = createObsidianLinkResolver({
      getFirstLinkpathDest: (linkPath, sourcePath) => {
        calls.push([linkPath, sourcePath]);
        return linkPath === "Target" ? target : null;
      },
    });

    expect(resolver("Source.md", "Target")).toEqual({
      kind: "file",
      path: "Folder/Target.md",
    });
    expect(resolver("Source.md", "Missing")).toEqual({ kind: "missing" });
    expect(calls).toEqual([
      ["Target", "Source.md"],
      ["Missing", "Source.md"],
    ]);
  });
});

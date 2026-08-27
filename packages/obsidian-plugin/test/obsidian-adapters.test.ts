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
  it("atomically compares and updates existing TFiles without creating missing files", async () => {
    const files = new Map([["A.md", new TFile("A.md")]]);
    const content = new Map([["A.md", "text:A.md"]]);
    const adapter = new ObsidianVaultFileAdapter({
      getAbstractFileByPath: (path) => files.get(path) ?? null,
      read: async (file) => content.get(file.path)!,
      process: async (file, update) => {
        const text = update(content.get(file.path)!);
        content.set(file.path, text);
        state.modified.push([file.path, text]);
        return text;
      },
    });
    const hashText = async (text: string) => `hash:${text}`;
    const edits = [
      {
        range: { from: 0, to: 4 },
        expectedText: "text",
        replacementText: "changed",
      },
    ];

    await expect(adapter.read("A.md")).resolves.toBe("text:A.md");
    await expect(
      adapter.compareAndUpdate(
        "A.md",
        "hash:text:A.md",
        "hash:changed:A.md",
        edits,
        hashText,
      ),
    ).resolves.toEqual({ kind: "updated" });
    await expect(
      adapter.compareAndUpdate(
        "Missing.md",
        "hash:x",
        "hash:y",
        edits,
        hashText,
      ),
    ).rejects.toThrow("vault-file-missing");
    expect(state.modified).toEqual([["A.md", "changed:A.md"]]);
  });

  it("resolves same-file fragments directly and other files through metadata", () => {
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
    expect(resolver("Folder/Source.md", "")).toEqual({
      kind: "file",
      path: "Folder/Source.md",
    });
    expect(resolver("Source.md", "Missing")).toEqual({ kind: "missing" });
    expect(calls).toEqual([
      ["Target", "Source.md"],
      ["Missing", "Source.md"],
    ]);
  });
});

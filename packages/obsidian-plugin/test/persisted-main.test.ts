import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";

const state = vi.hoisted(() => ({
  activePath: null as string | null,
  commands: [] as Array<{ id: string; callback: () => void }>,
  events: new Map<string, Array<(...args: unknown[]) => void>>(),
  files: new Map<string, string>(),
  linkTargets: new Map<string, string>(),
  loadedData: undefined as unknown,
  modals: [] as unknown[],
  modalButtons: [] as Array<{
    disabled: boolean;
    text: string;
    click(): void;
  }>,
  notices: [] as string[],
  readQueue: [] as Promise<string>[],
  reads: 0,
  savedData: [] as unknown[],
  saveQueue: [] as Promise<void>[],
  saveOutcomes: [] as Array<"ok" | "fail">,
  saveError: false,
  settingAvailable: true,
  settingOpens: 0,
  settingTabIds: [] as string[],
  writeFailures: [] as Array<{ error: Error; path: string }>,
  writeGates: [] as Array<{ path: string; promise: Promise<void> }>,
  writeGateHits: [] as string[],
  writes: [] as Array<[string, string]>,
}));

vi.mock("obsidian", () => {
  class TFile {
    extension: string;
    constructor(readonly path: string) {
      this.extension = path.endsWith(".md") ? "md" : "txt";
    }
  }
  const file = (path: string | null) =>
    path && state.files.has(path) ? new TFile(path) : null;
  const on = (name: string, callback: (...args: unknown[]) => void) => {
    const callbacks = state.events.get(name) ?? [];
    callbacks.push(callback);
    state.events.set(name, callbacks);
    return { name, callback };
  };
  class Plugin {
    app = {
      workspace: {
        getActiveFile: () => file(state.activePath),
        on,
      },
      vault: {
        getAbstractFileByPath: (path: string) => file(path),
        getMarkdownFiles: () =>
          [...state.files.keys()]
            .filter((path) => path.endsWith(".md"))
            .map((path) => new TFile(path)),
        modify: async (target: TFile, text: string) => {
          const failureIndex = state.writeFailures.findIndex(
            (failure) => failure.path === target.path,
          );
          const failure =
            failureIndex < 0
              ? undefined
              : state.writeFailures.splice(failureIndex, 1)[0];
          if (failure) throw failure.error;
          const index = state.writeGates.findIndex(
            (gate) => gate.path === target.path,
          );
          const gate =
            index < 0 ? undefined : state.writeGates.splice(index, 1)[0];
          if (gate) {
            state.writeGateHits.push(target.path);
            await gate.promise;
          }
          state.writes.push([target.path, text]);
          state.files.set(target.path, text);
        },
        process: async (target: TFile, update: (text: string) => string) => {
          const failureIndex = state.writeFailures.findIndex(
            (failure) => failure.path === target.path,
          );
          const failure =
            failureIndex < 0
              ? undefined
              : state.writeFailures.splice(failureIndex, 1)[0];
          if (failure) throw failure.error;
          const index = state.writeGates.findIndex(
            (gate) => gate.path === target.path,
          );
          const gate =
            index < 0 ? undefined : state.writeGates.splice(index, 1)[0];
          if (gate) {
            state.writeGateHits.push(target.path);
            await gate.promise;
          }
          const text = update(state.files.get(target.path) ?? "");
          state.writes.push([target.path, text]);
          state.files.set(target.path, text);
          return text;
        },
        on,
        read: async (target: TFile) => {
          state.reads += 1;
          const queued = state.readQueue.shift();
          if (queued) return queued;
          const text = state.files.get(target.path);
          if (text === undefined) throw new Error("missing");
          return text;
        },
      },
      metadataCache: {
        getFirstLinkpathDest: (linkPath: string) =>
          file(state.linkTargets.get(linkPath) ?? null),
      },
      get setting() {
        return state.settingAvailable
          ? {
              open: () => {
                state.settingOpens += 1;
              },
              openTabById: (id: string) => state.settingTabIds.push(id),
            }
          : {};
      },
    };
    manifest = { id: "heading-keeper" };
    addCommand(command: { id: string; callback: () => void }) {
      state.commands.push(command);
    }
    addSettingTab() {}
    registerEditorExtension() {}
    registerMarkdownPostProcessor() {}
    registerEvent() {}
    async loadData() {
      return state.loadedData;
    }
    async saveData(value: unknown) {
      const queued = state.saveQueue.shift();
      if (queued) await queued;
      if (state.saveError || state.saveOutcomes.shift() === "fail") {
        throw new Error("storage");
      }
      state.savedData.push(value);
    }
  }
  class Modal {
    contentEl = {
      empty() {},
      createEl(tag: string, options?: { text?: string }) {
        if (tag === "button") {
          let listener = () => undefined;
          const button = {
            disabled: false,
            text: options?.text ?? "",
            click: () => listener(),
            setAttr() {},
            addEventListener(_name: string, callback: () => void) {
              listener = callback;
            },
            createEl() {},
          };
          state.modalButtons.push(button);
          return button;
        }
        return { setAttr() {}, addEventListener() {}, createEl() {} };
      },
      setAttr() {},
    };
    constructor(readonly app: unknown) {}
    open() {
      state.modals.push(this);
      (this as { onOpen?: () => void }).onOpen?.();
    }
    close() {
      (this as { onClose?: () => void }).onClose?.();
    }
  }
  class Notice {
    constructor(message: string) {
      state.notices.push(message);
    }
  }
  class MarkdownRenderChild {
    constructor(readonly containerEl: unknown) {}
  }
  class PluginSettingTab {
    containerEl = { empty() {}, createEl() {} };
    constructor(
      readonly app: unknown,
      readonly plugin: unknown,
    ) {}
  }
  class Setting {
    setName() {
      return this;
    }
    setDesc() {
      return this;
    }
    addDropdown() {
      return this;
    }
    addText() {
      return this;
    }
    addButton(
      callback: (button: {
        setButtonText(text: string): unknown;
        onClick(cb: () => void): unknown;
      }) => void,
    ) {
      callback({
        setButtonText() {
          return this;
        },
        onClick() {
          return this;
        },
      });
      return this;
    }
  }
  return {
    MarkdownRenderChild,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    TFile,
  };
});

vi.mock("../src/editor-extension.js", () => ({
  createHeadingKeeperExtension: () => ({}),
  refreshHeadingKeeperExtensions: () => undefined,
}));

import { HeadingKeeperPlugin } from "../src/main.js";
import { sha256Text } from "../src/persistence/plan-service.js";
import { invertEdits } from "../src/persistence/edits.js";
import type {
  PersistedOperation,
  PersistenceDependencies,
} from "../src/persistence/types.js";

beforeEach(() => {
  state.activePath = null;
  state.commands.length = 0;
  state.events.clear();
  state.files.clear();
  state.linkTargets.clear();
  state.loadedData = { ...DEFAULT_STORED_SETTINGS, mode: "persisted" };
  state.modals.length = 0;
  state.modalButtons.length = 0;
  state.notices.length = 0;
  state.readQueue.length = 0;
  state.reads = 0;
  state.savedData.length = 0;
  state.saveQueue.length = 0;
  state.saveOutcomes.length = 0;
  state.saveError = false;
  state.settingAvailable = true;
  state.settingOpens = 0;
  state.settingTabIds.length = 0;
  state.writeFailures.length = 0;
  state.writeGates.length = 0;
  state.writeGateHits.length = 0;
  state.writes.length = 0;
});

describe("persisted plugin workflow", () => {
  it("rejects apply without an exact in-memory preview", async () => {
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.applyCurrentPreview();
    expect(state.writes).toEqual([]);
    expect(state.notices.at(-1)).toBe("Create a persisted preview first.");
  });

  it("requires persisted mode for preview, apply, and removal", async () => {
    state.loadedData = { ...DEFAULT_STORED_SETTINGS, mode: "virtual" };
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    await plugin.previewPersisted("add");
    await plugin.previewPersisted("remove");
    await plugin.applyCurrentPreview();

    expect(state.reads).toBe(1);
    expect(state.writes).toEqual([]);
    expect(state.notices).toEqual([
      "Switch to persisted mode first.",
      "Switch to persisted mode first.",
      "Switch to persisted mode first.",
    ]);
  });

  it("reports a no-op preview without retaining apply authority", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "# Outside");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    await plugin.previewPersisted("add");

    expect(plugin.activePreview).toBeNull();
    expect(state.modals).toHaveLength(0);
    expect(state.notices.at(-1)).toBe("No safe persisted changes were found.");
  });

  it("previews and explicitly applies target and global link changes", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    state.files.set("Links.md", "[[Target#Alpha|alias]]");
    state.linkTargets.set("Target", "Target.md");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    await plugin.previewPersisted("add");
    expect(plugin.activePreview?.targetPath).toBe("Target.md");
    expect(state.modals).toHaveLength(1);
    await plugin.applyCurrentPreview();

    expect(state.files.get("Target.md")).toBe("## 1. Alpha");
    expect(state.files.get("Links.md")).toBe("[[Target#1. Alpha|alias]]");
    expect(state.notices.at(-1)).toBe("Persisted changes completed.");
  });

  it("consumes apply authority synchronously across command and modal triggers", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.previewPersisted("add");

    const commandApply = plugin.applyCurrentPreview();
    state.modalButtons.at(-1)?.click();
    const duplicateApply = plugin.applyCurrentPreview();
    await Promise.all([commandApply, duplicateApply]);

    expect(state.writes).toEqual([["Target.md", "## 1. Alpha"]]);
  });

  it("revokes only the closed preview modal nonce and keeps command authority", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.previewPersisted("add");
    const modal = state.modals.at(-1) as { close(): void };
    const staleButton = state.modalButtons.at(-1);

    modal.close();
    staleButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.writes).toEqual([]);
    expect(plugin.activePreview).not.toBeNull();
    await plugin.applyCurrentPreview();
    expect(state.writes).toEqual([["Target.md", "## 1. Alpha"]]);
  });

  it("invalidates an older modal nonce when a newer preview opens", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.previewPersisted("add");
    const oldButton = state.modalButtons.at(-1);
    await plugin.previewPersisted("add");
    const currentButton = state.modalButtons.at(-1);

    oldButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.writes).toEqual([]);

    currentButton?.click();
    await vi.waitFor(() => {
      expect(state.files.get("Target.md")).toBe("## 1. Alpha");
    });
    expect(state.writes).toEqual([["Target.md", "## 1. Alpha"]]);
  });

  it("invalidates preview on settings and active-file changes", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    state.files.set("Other.md", "## Other");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.previewPersisted("add");
    await plugin.saveSettings({ ...plugin.settings, titleSeparator: " · " });
    await plugin.applyCurrentPreview();
    expect(state.writes).toEqual([]);

    await plugin.previewPersisted("add");
    state.activePath = "Other.md";
    state.events.get("file-open")?.forEach((callback) => callback());
    await plugin.applyCurrentPreview();
    expect(state.writes).toEqual([]);
  });

  it("keeps settings but invalidates preview when storage rejects a settings save", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.previewPersisted("add");
    state.saveError = true;

    await expect(
      plugin.saveSettings({ ...plugin.settings, titleSeparator: " · " }),
    ).resolves.toBe(false);

    expect(plugin.settings.titleSeparator).toBe(". ");
    expect(plugin.activePreview).toBeNull();
    expect(state.notices.at(-1)).toBe("Plugin data could not be saved.");
  });

  it("gates preview and apply throughout concurrent settings saves", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    state.saveQueue.push(firstGate.promise, secondGate.promise);
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.previewPersisted("add");
    const readsBeforeSaves = state.reads;

    const firstSave = plugin.saveSettingsPatch({
      titleSeparator: " · ",
    });
    const secondSave = plugin.saveSettingsPatch({
      numberSeparator: "-",
    });

    expect(plugin.activePreview).toBeNull();
    await plugin.previewPersisted("add");
    await plugin.applyCurrentPreview();
    expect(state.reads).toBe(readsBeforeSaves);
    expect(state.notices.slice(-2)).toEqual([
      "Settings are still being saved.",
      "Settings are still being saved.",
    ]);

    firstGate.resolve(undefined);
    await firstSave;
    await plugin.previewPersisted("add");
    expect(state.reads).toBe(readsBeforeSaves);
    expect(state.notices.at(-1)).toBe("Settings are still being saved.");

    secondGate.resolve(undefined);
    await secondSave;
    expect(plugin.settings).toMatchObject({
      titleSeparator: " · ",
      numberSeparator: "-",
    });
    await plugin.previewPersisted("add");
    expect(state.reads).toBeGreaterThan(readsBeforeSaves);
  });

  it("keeps the first committed patch when the second patch save fails", async () => {
    state.saveOutcomes.push("ok", "fail");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    const results = await Promise.all([
      plugin.saveSettingsPatch({ titleSeparator: " · " }),
      plugin.saveSettingsPatch({ numberSeparator: "-" }),
    ]);

    expect(results).toEqual([true, false]);
    expect(plugin.settings).toMatchObject({
      titleSeparator: " · ",
      numberSeparator: ".",
    });
  });

  it("bases a second successful patch on the old commit after the first fails", async () => {
    state.saveOutcomes.push("fail", "ok");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    const results = await Promise.all([
      plugin.saveSettingsPatch({ titleSeparator: " · " }),
      plugin.saveSettingsPatch({ numberSeparator: "-" }),
    ]);

    expect(results).toEqual([false, true]);
    expect(plugin.settings).toMatchObject({
      titleSeparator: ". ",
      numberSeparator: "-",
    });
  });

  it("keeps last-request replacement semantics for the public full save", async () => {
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    const results = await Promise.all([
      plugin.saveSettingsPatch({ titleSeparator: " · " }),
      plugin.saveSettings({
        ...DEFAULT_STORED_SETTINGS,
        mode: "persisted",
        numberSeparator: "-",
      }),
    ]);

    expect(results).toEqual([true, true]);
    expect(plugin.settings).toEqual({
      ...DEFAULT_STORED_SETTINGS,
      mode: "persisted",
      numberSeparator: "-",
    });
  });

  it("keeps a stale source at zero writes through executor preflight", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.previewPersisted("add");
    state.files.set("Target.md", "## external");

    await plugin.applyCurrentPreview();

    expect(state.writes).toEqual([]);
    expect(state.notices.at(-1)).toBe(
      "Preview is stale; no files were changed.",
    );
  });

  it("previews removal and preserves semantic numeric headings", async () => {
    state.activePath = "Target.md";
    state.files.set("Target.md", "## 1. Alpha\r\n## 2026 plan");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();

    await plugin.previewPersisted("remove");
    await plugin.applyCurrentPreview();

    expect(state.files.get("Target.md")).toBe("## Alpha\r\n## 2026 plan");
  });

  it("guards the narrow settings capability and its stable fallback", async () => {
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    plugin.openSettings();
    expect(state.settingOpens).toBe(1);
    expect(state.settingTabIds).toEqual(["heading-keeper"]);

    state.settingAvailable = false;
    plugin.openSettings();
    expect(state.notices.at(-1)).toBe(
      "Open Obsidian Settings to configure Heading Keeper.",
    );
  });

  it("reloads an interrupted durable journal and exposes recovery", async () => {
    const beforeText = "## Alpha";
    const afterText = "## 1. Alpha";
    const operation = {
      id: "recover-1",
      createdAt: "2026-08-25T00:00:00.000Z",
      state: "recovery-required" as const,
      completedPaths: ["Target.md"],
      files: [await plannedFile("Target.md", beforeText, afterText)],
    };
    state.activePath = "Target.md";
    state.files.set("Target.md", afterText);
    state.loadedData = {
      settings: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      journals: { "recover-1": operation },
      latestJournalId: "recover-1",
    };
    const plugin = new HeadingKeeperPlugin();

    await plugin.onload();
    await plugin.openRecoveryCenter();

    expect(state.notices[0]).toBe("A persisted operation requires recovery.");
    expect(state.modals).toHaveLength(1);
  });

  it("uses one recovery authority across multiple modals and double clicks", async () => {
    const beforeText = "## Alpha";
    const afterText = "## 1. Alpha";
    const operation = {
      id: "recover-once",
      createdAt: "2026-08-25T00:00:00.000Z",
      state: "recovery-required" as const,
      completedPaths: ["Target.md"],
      files: [await plannedFile("Target.md", beforeText, afterText)],
    };
    state.activePath = "Target.md";
    state.files.set("Target.md", afterText);
    state.loadedData = {
      settings: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      journals: { "recover-once": operation },
      latestJournalId: "recover-once",
    };
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.openRecoveryCenter();
    const firstModal = state.modals.at(-1) as { close(): void };
    const first = state.modalButtons.at(-1);

    firstModal.close();
    first?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.writes).toEqual([]);

    await plugin.openRecoveryCenter();
    const second = state.modalButtons.at(-1);
    second?.click();
    second?.click();
    await vi.waitFor(() => {
      expect(state.files.get("Target.md")).toBe(beforeText);
    });

    expect(state.writes).toEqual([["Target.md", beforeText]]);
  });

  it("revokes an old recovery callback before apply reaches a later link file", async () => {
    const targetBefore = "## Alpha";
    const targetAfter = "## 1. Alpha";
    const recovery = {
      id: "old-recovery",
      createdAt: "2026-08-25T00:00:00.000Z",
      state: "recovery-required" as const,
      completedPaths: ["Target.md"],
      files: [await plannedFile("Target.md", targetBefore, targetAfter)],
    };
    state.activePath = "Target.md";
    state.files.set("Target.md", targetAfter);
    state.files.set("Links.md", "[[Target#Alpha]]");
    state.linkTargets.set("Target", "Target.md");
    state.loadedData = {
      settings: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      journals: { "old-recovery": recovery },
      latestJournalId: "old-recovery",
    };
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.openRecoveryCenter();
    const staleRecovery = state.modalButtons.at(-1);

    state.files.set("Target.md", targetBefore);
    await plugin.previewPersisted("add");
    const linkGate = deferred<void>();
    state.writeGates.push({ path: "Links.md", promise: linkGate.promise });
    const applying = plugin.applyCurrentPreview();
    await vi.waitFor(() => {
      expect(state.files.get("Target.md")).toBe(targetAfter);
    });

    staleRecovery?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.files.get("Target.md")).toBe(targetAfter);

    linkGate.resolve(undefined);
    await applying;
    expect(state.files.get("Links.md")).toBe("[[Target#1. Alpha]]");
    expect(state.writes).not.toContainEqual(["Target.md", targetBefore]);
    const latest = state.savedData.at(-1) as {
      summaries?: Array<{ state?: string; fileCount?: number }>;
    };
    expect(
      (latest.summaries ?? []).some(
        (operation) =>
          operation.state === "completed" && operation.fileCount === 2,
      ),
    ).toBe(true);
  });

  it("rejects apply while recovery owns the global mutation authority", async () => {
    const targetBefore = "## Alpha";
    const recovery = await recoveryOperation(
      "other-recovery",
      "Other.md",
      "## Other",
      "## 1. Other",
    );
    state.activePath = "Target.md";
    state.files.set("Target.md", targetBefore);
    state.files.set("Other.md", "## 1. Other");
    state.loadedData = {
      settings: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      journals: { "other-recovery": recovery },
      latestJournalId: "other-recovery",
    };
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.previewPersisted("add");
    await plugin.openRecoveryCenter();
    const gate = deferred<void>();
    state.writeGates.push({ path: "Other.md", promise: gate.promise });

    state.modalButtons.at(-1)?.click();
    await plugin.applyCurrentPreview();
    expect(state.files.get("Target.md")).toBe(targetBefore);

    gate.resolve(undefined);
    await vi.waitFor(() => {
      expect(state.files.get("Other.md")).toBe("## Other");
    });
    expect(state.writes).toEqual([["Other.md", "## Other"]]);
  });

  it("invalidates recovery callbacks from different journals sharing a file", async () => {
    const afterText = "## Shared";
    const first = await recoveryOperation(
      "first-recovery",
      "Target.md",
      "## First",
      afterText,
    );
    const second = await recoveryOperation(
      "second-recovery",
      "Target.md",
      "## Second",
      afterText,
    );
    state.files.set("Target.md", afterText);
    state.loadedData = {
      settings: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      journals: {
        "first-recovery": first,
        "second-recovery": second,
      },
      latestJournalId: "second-recovery",
    };
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    const access = recoveryAccess(plugin);
    const dependencies: PersistenceDependencies = {
      vault: access.vaultAdapter,
      journal: access.dataStore.journal,
      hashText: sha256Text,
    };
    await access.openRecoveryOperation(first, 0, dependencies);
    const firstButton = state.modalButtons.at(-1);
    await access.openRecoveryOperation(second, 0, dependencies);
    const secondButton = state.modalButtons.at(-1);
    const gate = deferred<void>();
    state.writeGates.push({ path: "Target.md", promise: gate.promise });

    firstButton?.click();
    await vi.waitFor(() => {
      expect(state.writeGateHits).toEqual(["Target.md"]);
    });
    secondButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.writes).not.toContainEqual(["Target.md", "## Second"]);

    gate.resolve(undefined);
    await vi.waitFor(() => {
      expect(state.files.get("Target.md")).toBe("## First");
    });
    expect(state.writes).toEqual([["Target.md", "## First"]]);
  });

  it("does not restore from an old modal after its durable journal completes", async () => {
    const recovery = await recoveryOperation(
      "completed-recovery",
      "Target.md",
      "## Alpha",
      "## 1. Alpha",
    );
    state.activePath = "Target.md";
    state.files.set("Target.md", "## 1. Alpha");
    state.loadedData = {
      settings: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      journals: { "completed-recovery": recovery },
      latestJournalId: "completed-recovery",
    };
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.openRecoveryCenter();
    const staleRecovery = state.modalButtons.at(-1);
    const access = recoveryAccess(plugin);
    await access.dataStore.journal.save({
      ...recovery,
      state: "completed",
      completedPaths: ["Target.md"],
    });

    staleRecovery?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.files.get("Target.md")).toBe("## 1. Alpha");
    expect(state.writes).toEqual([]);
  });

  it("releases recovery authority after a restore failure", async () => {
    const recovery = await recoveryOperation(
      "failed-recovery",
      "Other.md",
      "## Other",
      "## 1. Other",
    );
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    state.files.set("Other.md", "## 1. Other");
    state.loadedData = {
      settings: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      journals: { "failed-recovery": recovery },
      latestJournalId: "failed-recovery",
    };
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.previewPersisted("add");
    await plugin.openRecoveryCenter();
    state.writeFailures.push({
      path: "Other.md",
      error: new Error("private restore detail"),
    });

    state.modalButtons.at(-1)?.click();
    await vi.waitFor(() => {
      expect(state.notices.at(-1)).toBe(
        "Writing stopped. Open recovery before continuing.",
      );
    });
    await plugin.applyCurrentPreview();

    expect(state.files.get("Target.md")).toBe("## 1. Alpha");
    expect(state.notices.join("\n")).not.toContain("private restore detail");
  });

  it("invalidates a recovery callback after unload", async () => {
    const recovery = await recoveryOperation(
      "unloaded-recovery",
      "Target.md",
      "## Alpha",
      "## 1. Alpha",
    );
    state.activePath = "Target.md";
    state.files.set("Target.md", "## 1. Alpha");
    state.loadedData = {
      settings: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      journals: { "unloaded-recovery": recovery },
      latestJournalId: "unloaded-recovery",
    };
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.openRecoveryCenter();
    const staleRecovery = state.modalButtons.at(-1);

    plugin.onunload();
    staleRecovery?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.files.get("Target.md")).toBe("## 1. Alpha");
    expect(state.writes).toEqual([]);
  });

  it("finalizes an all-pending recovery with zero vault writes", async () => {
    const beforeText = "## Alpha";
    const afterText = "## 1. Alpha";
    const operation = {
      id: "pending-only",
      createdAt: "2026-08-25T00:00:00.000Z",
      state: "applying" as const,
      completedPaths: [],
      files: [await plannedFile("Target.md", beforeText, afterText)],
    };
    state.activePath = "Target.md";
    state.files.set("Target.md", beforeText);
    state.loadedData = {
      settings: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
      journals: { "pending-only": operation },
      latestJournalId: "pending-only",
    };
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    await plugin.openRecoveryCenter();

    expect(state.modalButtons.at(-1)?.text).toBe("Complete recovery");
    state.modalButtons.at(-1)?.click();
    await vi.waitFor(() => {
      const latest = state.savedData.at(-1) as {
        summaries?: Array<{ id?: string; state?: string }>;
      };
      expect(
        latest.summaries?.find((summary) => summary.id === "pending-only")
          ?.state,
      ).toBe("restored");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.writes).toEqual([]);
    expect(state.modals).toHaveLength(1);
  });

  it("drops a late preview callback after unload", async () => {
    const delayed = deferred<string>();
    state.activePath = "Target.md";
    state.files.set("Target.md", "## Alpha");
    const plugin = new HeadingKeeperPlugin();
    await plugin.onload();
    state.readQueue.push(delayed.promise);

    const preview = plugin.previewPersisted("add");
    plugin.onunload();
    delayed.resolve("## Alpha");
    await preview;

    expect(plugin.activePreview).toBeNull();
    expect(state.modals).toHaveLength(0);
    expect(state.writes).toEqual([]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

async function recoveryOperation(
  id: string,
  path: string,
  beforeText: string,
  afterText: string,
): Promise<PersistedOperation> {
  return {
    id,
    createdAt: "2026-08-25T00:00:00.000Z",
    state: "recovery-required",
    completedPaths: [path],
    files: [await plannedFile(path, beforeText, afterText)],
  };
}

async function plannedFile(
  path: string,
  beforeText: string,
  afterText: string,
) {
  const prefixLength = afterText.length - beforeText.length;
  const insertion = prefixLength > 0 && afterText.endsWith(beforeText.slice(3));
  const edits = insertion
    ? [
        {
          range: { from: 3, to: 3 },
          expectedText: "",
          replacementText: afterText.slice(3, 3 + prefixLength),
        },
      ]
    : [
        {
          range: { from: 0, to: beforeText.length },
          expectedText: beforeText,
          replacementText: afterText,
        },
      ];
  return {
    path,
    beforeHash: await sha256Text(beforeText),
    afterHash: await sha256Text(afterText),
    edits,
    inverseEdits: invertEdits(beforeText, edits),
    role: "target" as const,
  };
}

function recoveryAccess(plugin: HeadingKeeperPlugin): {
  dataStore: { journal: PersistenceDependencies["journal"] };
  openRecoveryOperation(
    operation: PersistedOperation,
    generation: number,
    dependencies: PersistenceDependencies,
  ): Promise<void>;
  vaultAdapter: PersistenceDependencies["vault"];
} {
  return plugin as unknown as {
    dataStore: { journal: PersistenceDependencies["journal"] };
    openRecoveryOperation(
      operation: PersistedOperation,
      generation: number,
      dependencies: PersistenceDependencies,
    ): Promise<void>;
    vaultAdapter: PersistenceDependencies["vault"];
  };
}

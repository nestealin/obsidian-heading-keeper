import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import { sha256Text } from "../src/persistence/plan-service.js";
import type { PersistedOperation } from "../src/persistence/types.js";
import { PluginDataStore } from "../src/plugin-data.js";

async function operation(id = "op-1"): Promise<PersistedOperation> {
  return {
    id,
    createdAt: "2026-08-25T00:00:00.000Z",
    state: "previewed",
    completedPaths: [],
    files: [
      {
        path: "Target.md",
        beforeText: "## A",
        beforeHash: await sha256Text("## A"),
        afterText: "## 1. A",
        afterHash: await sha256Text("## 1. A"),
        role: "target",
      },
    ],
  };
}

describe("PluginDataStore", () => {
  it("loads fresh defaults without reporting settings errors", async () => {
    const store = new PluginDataStore(
      async () => undefined,
      async () => undefined,
      sha256Text,
    );

    const loaded = await store.initialize();

    expect(loaded.settings).toEqual(DEFAULT_STORED_SETTINGS);
    expect(loaded.settingsErrors).toEqual([]);
  });

  it("migrates legacy bare settings and saves the versioned envelope", async () => {
    const saves: unknown[] = [];
    const store = new PluginDataStore(
      async () => ({ ...DEFAULT_STORED_SETTINGS, mode: "persisted" }),
      async (value) => saves.push(value),
      sha256Text,
    );

    const loaded = await store.initialize();
    await store.saveSettings({ ...loaded.settings, locale: "zh" });

    expect(loaded.settings.mode).toBe("persisted");
    expect(saves.at(-1)).toEqual({
      settings: expect.objectContaining({ locale: "zh", mode: "persisted" }),
      journals: {},
      latestJournalId: null,
    });
  });

  it("serializes concurrent settings and journal saves without clobbering", async () => {
    const saves: unknown[] = [];
    const store = new PluginDataStore(
      async () => undefined,
      async (value) => {
        await Promise.resolve();
        saves.push(value);
      },
      sha256Text,
    );
    await store.initialize();
    const op = await operation();

    await Promise.all([
      store.saveSettings({ ...DEFAULT_STORED_SETTINGS, mode: "persisted" }),
      store.journal.save(op),
    ]);

    expect(saves.at(-1)).toEqual({
      settings: expect.objectContaining({ mode: "persisted" }),
      journals: { "op-1": expect.objectContaining({ id: "op-1" }) },
      latestJournalId: "op-1",
    });
  });

  it("ignores malformed journals and returns frozen validated snapshots", async () => {
    const valid = await operation();
    const store = new PluginDataStore(
      async () => ({
        settings: DEFAULT_STORED_SETTINGS,
        journals: { "op-1": valid, bad: { id: "bad" } },
        latestJournalId: "bad",
      }),
      async () => undefined,
      sha256Text,
    );

    const loaded = await store.initialize();
    const restored = await store.journal.load("op-1");

    expect(loaded.diagnostics).toEqual(["journal-invalid"]);
    expect(store.latestJournalId).toBe("op-1");
    expect(restored).not.toBe(valid);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored?.files)).toBe(true);
  });

  it("rejects invalid journal snapshots without persisting", async () => {
    let saves = 0;
    const store = new PluginDataStore(
      async () => undefined,
      async () => {
        saves += 1;
      },
      sha256Text,
    );
    await store.initialize();
    const invalid = { ...(await operation()), files: [] };

    await expect(store.journal.save(invalid)).rejects.toThrow(
      "journal-invalid",
    );
    expect(saves).toBe(0);
  });
});

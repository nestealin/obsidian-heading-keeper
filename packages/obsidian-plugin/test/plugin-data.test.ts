import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import { sha256Text } from "../src/persistence/plan-service.js";
import type { PersistedOperation } from "../src/persistence/types.js";
import { PluginDataStore } from "../src/plugin-data.js";
import { invertEdits } from "../src/persistence/edits.js";

async function operation(
  id = "op-1",
  state: PersistedOperation["state"] = "previewed",
  createdAt = "2026-08-25T00:00:00.000Z",
): Promise<PersistedOperation> {
  const beforeText = "## A";
  const afterText = "## 1. A";
  const edits = [
    {
      range: { from: 3, to: 3 },
      expectedText: "",
      replacementText: "1. ",
    },
  ];
  return {
    id,
    createdAt,
    state,
    completedPaths: state === "completed" ? ["Target.md"] : [],
    files: [
      {
        path: "Target.md",
        beforeHash: await sha256Text(beforeText),
        afterHash: await sha256Text(afterText),
        edits,
        inverseEdits: invertEdits(beforeText, edits),
        role: "target",
      },
    ],
  };
}

describe("PluginDataStore", () => {
  it("replaces completed journals with text-free summaries", async () => {
    const saves: unknown[] = [];
    const store = new PluginDataStore(
      async () => undefined,
      async (value) => saves.push(value),
      sha256Text,
      () => Date.parse("2026-08-27T00:00:00.000Z"),
    );
    await store.initialize();

    await store.journal.save(await operation("done", "completed"));

    const serialized = JSON.stringify(saves.at(-1));
    expect(serialized).not.toContain('"edits"');
    expect(serialized).not.toContain('"inverseEdits"');
    expect(saves.at(-1)).toMatchObject({
      journals: {},
      summaries: [
        {
          id: "done",
          completedAt: "2026-08-27T00:00:00.000Z",
          state: "completed",
          fileCount: 1,
          editCount: 1,
        },
      ],
    });
  });

  it("rejects a payload above one MiB without changing committed state", async () => {
    const saves: unknown[] = [];
    const store = new PluginDataStore(
      async () => undefined,
      async (value) => saves.push(value),
      sha256Text,
    );
    await store.initialize();
    const oversized = await operation("oversized", "applying");
    const huge = "x".repeat(1_048_576);
    const file = oversized.files[0]!;
    const candidate = {
      ...oversized,
      files: [
        {
          ...file,
          edits: [
            {
              range: { from: 0, to: 0 },
              expectedText: "",
              replacementText: huge,
            },
          ],
          inverseEdits: [
            {
              range: { from: 0, to: huge.length },
              expectedText: huge,
              replacementText: "",
            },
          ],
        },
      ],
    };

    await expect(store.journal.save(candidate)).rejects.toThrow(
      "storage-limit",
    );
    await expect(store.journal.load("oversized")).resolves.toBeNull();
    expect(saves).toEqual([]);
  });

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
      summaries: [],
    });
  });

  it("recognizes an envelope by own keys and keeps valid recovery when settings is null", async () => {
    const recovery = await operation("recover", "recovery-required");
    const saves: unknown[] = [];
    const store = new PluginDataStore(
      async () => ({
        settings: null,
        journals: { recover: recovery },
        latestJournalId: "recover",
      }),
      async (value) => saves.push(value),
      sha256Text,
    );

    const loaded = await store.initialize();
    await store.saveSettings({ ...DEFAULT_STORED_SETTINGS, locale: "zh" });

    expect(loaded.settingsErrors).toEqual([
      { field: "settings", message: "Expected a settings object." },
    ]);
    expect(store.latestRecoveryOperation()?.id).toBe("recover");
    expect(saves.at(-1)).toMatchObject({
      journals: { recover: { id: "recover" } },
      latestJournalId: "recover",
    });
  });

  it("migrates a valid v0.1 full-text recovery into minimal edits", async () => {
    const beforeText = "## Alpha\nprivate body marker";
    const afterText = "## 1. Alpha\nprivate body marker";
    const saves: unknown[] = [];
    const legacy = {
      id: "legacy",
      createdAt: "2026-08-26T00:00:00.000Z",
      state: "recovery-required",
      completedPaths: ["Target.md"],
      files: [
        {
          path: "Target.md",
          beforeText,
          beforeHash: await sha256Text(beforeText),
          afterText,
          afterHash: await sha256Text(afterText),
          role: "target",
        },
      ],
    };
    const store = new PluginDataStore(
      async () => ({
        settings: DEFAULT_STORED_SETTINGS,
        journals: { legacy },
        latestJournalId: "legacy",
      }),
      async (value) => saves.push(value),
      sha256Text,
    );

    const loaded = await store.initialize();
    const migrated = store.latestRecoveryOperation();

    expect(loaded.diagnostics).toEqual(["journal-migrated"]);
    expect(migrated?.files[0]?.edits).toEqual([
      {
        range: { from: 3, to: 3 },
        expectedText: "",
        replacementText: "1. ",
      },
    ]);
    expect(saves).toHaveLength(1);
    expect(JSON.stringify(saves.at(-1))).not.toContain("private body marker");
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
      summaries: [],
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

  it("does not commit a failed settings save or leak it into a later journal save", async () => {
    const saves: unknown[] = [];
    let fail = true;
    const store = new PluginDataStore(
      async () => undefined,
      async (value) => {
        if (fail) {
          fail = false;
          throw new Error("disk");
        }
        saves.push(value);
      },
      sha256Text,
    );
    await store.initialize();

    await expect(
      store.saveSettings({ ...DEFAULT_STORED_SETTINGS, locale: "zh" }),
    ).rejects.toThrow("disk");
    expect(store.settings.locale).toBe("auto");
    await store.journal.save(await operation("next"));

    expect(saves.at(-1)).toMatchObject({
      settings: { locale: "auto" },
      journals: { next: { id: "next" } },
    });
  });

  it("does not commit a failed applying journal or leak it into a later settings save", async () => {
    const saves: unknown[] = [];
    let fail = true;
    const store = new PluginDataStore(
      async () => undefined,
      async (value) => {
        if (fail) {
          fail = false;
          throw new Error("disk");
        }
        saves.push(value);
      },
      sha256Text,
    );
    await store.initialize();
    const applying = await operation("phantom", "applying");

    await expect(store.journal.save(applying)).rejects.toThrow("disk");
    await expect(store.journal.load("phantom")).resolves.toBeNull();
    await store.saveSettings({ ...DEFAULT_STORED_SETTINGS, locale: "zh" });

    expect(saves.at(-1)).toMatchObject({
      settings: { locale: "zh" },
      journals: {},
      latestJournalId: null,
    });
  });

  it("selects latest recovery by validated pointer then stable createdAt and id fallback", async () => {
    const older = await operation(
      "z-older",
      "recovery-required",
      "2026-08-24T00:00:00.000Z",
    );
    const tieA = await operation(
      "a-tie",
      "applying",
      "2026-08-25T00:00:00.000Z",
    );
    const tieZ = await operation(
      "z-tie",
      "restoring",
      "2026-08-25T00:00:00.000Z",
    );
    const completed = await operation(
      "done",
      "completed",
      "2026-08-26T00:00:00.000Z",
    );
    const pointed = new PluginDataStore(
      async () => ({
        settings: DEFAULT_STORED_SETTINGS,
        journals: {
          "z-tie": tieZ,
          done: completed,
          "a-tie": tieA,
          "z-older": older,
        },
        latestJournalId: "z-older",
      }),
      async () => undefined,
      sha256Text,
    );
    await pointed.initialize();
    expect(pointed.latestRecoveryOperation()?.id).toBe("z-older");

    const fallback = new PluginDataStore(
      async () => ({
        settings: DEFAULT_STORED_SETTINGS,
        journals: { "z-tie": tieZ, done: completed, "a-tie": tieA },
        latestJournalId: "done",
      }),
      async () => undefined,
      sha256Text,
    );
    await fallback.initialize();
    expect(fallback.latestRecoveryOperation()?.id).toBe("z-tie");
  });
});

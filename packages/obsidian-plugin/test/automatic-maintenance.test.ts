import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import {
  AutomaticMaintenance,
  realizedRenameIntents,
} from "../src/automatic-maintenance.js";
import { applyCheckedEdits } from "../src/persistence/edits.js";
import type {
  JournalStore,
  PersistedOperation,
} from "../src/persistence/types.js";

function journalHarness() {
  const pending = new Map<string, PersistedOperation>();
  const journal: JournalStore = {
    load: async (id) => pending.get(id) ?? null,
    save: async (operation) => {
      if (operation.state === "completed" || operation.state === "restored") {
        pending.delete(operation.id);
      } else {
        pending.set(operation.id, operation);
      }
    },
    listPending: () => [...pending.values()],
    savePending: async (operation) => {
      pending.set(operation.id, operation);
    },
    complete: async (operation) => {
      pending.delete(operation.id);
    },
    remove: async (id) => {
      pending.delete(id);
    },
    summaries: () => [],
  };
  return { journal, pending };
}

describe("AutomaticMaintenance", () => {
  it("keeps every intermediate heading alias when a rename chain reaches the saved title", () => {
    const intents = [
      ["Original", "Middle"],
      ["Middle", "Final"],
    ].map(([oldHeading, newHeading], index) => ({
      id: `intent-${index}`,
      createdAt: "2026-09-22T00:00:00Z",
      targetPath: "Target.md",
      renames: [
        {
          targetPath: "Target.md",
          oldHeading: oldHeading!,
          newHeading: newHeading!,
        },
      ],
    }));
    expect(realizedRenameIntents("## Final\n", intents)).toEqual({
      intentIds: ["intent-0", "intent-1"],
      renames: [
        {
          targetPath: "Target.md",
          oldHeading: "Original",
          newHeading: "Final",
        },
        { targetPath: "Target.md", oldHeading: "Middle", newHeading: "Final" },
      ],
    });
  });

  it("synchronizes a proven rename despite an unrelated stale input intent without discarding it", () => {
    const intents = [
      ["typing", "unfinished-input"],
      ["Old", "1. New"],
      ["Still present", "1. New"],
    ].map(([oldHeading, newHeading], index) => ({
      id: `intent-${index}`,
      createdAt: "2026-09-22T00:00:00Z",
      targetPath: "Target.md",
      renames: [
        {
          targetPath: "Target.md",
          oldHeading: oldHeading!,
          newHeading: newHeading!,
        },
      ],
    }));
    expect(
      realizedRenameIntents("## 1. New\n## Still present\n", intents),
    ).toEqual({
      intentIds: [],
      renames: [
        { targetPath: "Target.md", oldHeading: "Old", newHeading: "1. New" },
      ],
    });
    expect(
      realizedRenameIntents(
        "## 1. New\n## 1. New\n## Still present\n",
        intents,
      ),
    ).toBeNull();
  });

  it("durably stages a metadata rename before scheduling link synchronization", async () => {
    const content = new Map([
      ["Target.md", "## Renamed"],
      ["Links.md", "[[Target#Original]]"],
    ]);
    const intents: Array<{
      id: string;
      createdAt: string;
      targetPath: string;
      renames: Array<{
        targetPath: string;
        oldHeading: string;
        newHeading: string;
      }>;
    }> = [];
    const removed: string[][] = [];
    const { journal } = journalHarness();
    const maintenance = new AutomaticMaintenance({
      settings: () => ({ ...DEFAULT_STORED_SETTINGS, mode: "persisted" }),
      read: async (path) => content.get(path)!,
      indexReady: () => true,
      candidates: () => ["Links.md"],
      resolveTarget: () => ({ kind: "file", path: "Target.md" }),
      operationDependencies: {
        createId: () => "metadata-intent",
        now: () => "2026-08-31T00:00:00.000Z",
        hashText: async (text) => `hash:${text}`,
      },
      journal,
      renameIntents: {
        list: () => intents,
        stage: async (intent) => {
          intents.push({ ...intent, renames: [...intent.renames] });
        },
        remove: async (ids) => {
          removed.push([...ids]);
        },
      },
      execute: async (operation) => {
        for (const file of operation.files) {
          content.set(
            file.path,
            applyCheckedEdits(content.get(file.path)!, file.edits),
          );
        }
        return {
          kind: "completed",
          operation: {
            ...operation,
            state: "completed",
            completedPaths: operation.files.map((file) => file.path),
          },
        };
      },
      now: () => Date.parse("2026-08-31T00:00:00.000Z"),
    });

    await maintenance.acceptMetadataChange(
      "Target.md",
      ["Original"],
      ["Renamed"],
    );
    await maintenance.flush();

    expect(intents).toEqual([
      {
        id: "metadata-intent",
        createdAt: "2026-08-31T00:00:00.000Z",
        targetPath: "Target.md",
        renames: [
          {
            targetPath: "Target.md",
            oldHeading: "Original",
            newHeading: "Renamed",
          },
        ],
      },
    ]);
    expect(content.get("Links.md")).toBe("[[Target#Renamed]]");
    expect(removed).toEqual([["metadata-intent"]]);
  });

  it.each([false, true])(
    "coalesces rename chains into link-only work with stale history=%s",
    async (staleHistory) => {
      const content = new Map([
        ["Target.md", "## 1.1. Beta"],
        ["A.md", "[[Target#Beta]]"],
        ["B.md", "[Beta](Target.md#1.%20Beta)"],
        ["Never.md", "private unrelated body"],
      ]);
      const reads: string[] = [];
      const executed: PersistedOperation[] = [];
      const removedIntents: string[][] = [];
      const { journal } = journalHarness();
      const maintenance = new AutomaticMaintenance({
        settings: () => ({
          ...DEFAULT_STORED_SETTINGS,
          mode: "persisted",
        }),
        read: async (path) => {
          reads.push(path);
          return content.get(path)!;
        },
        indexReady: () => true,
        candidates: () => ["B.md", "A.md"],
        resolveTarget: () => ({ kind: "file", path: "Target.md" }),
        operationDependencies: {
          createId: () => "auto-1",
          now: () => "2026-08-27T00:00:00.000Z",
          hashText: async (text) => `hash:${text}`,
        },
        journal,
        renameIntents: {
          list: () => [
            {
              id: "intent-1",
              createdAt: "2026-08-31T00:00:00.000Z",
              targetPath: "Target.md",
              renames: [
                {
                  targetPath: "Target.md",
                  oldHeading: "Beta",
                  newHeading: "1. Beta",
                },
                {
                  targetPath: "Target.md",
                  oldHeading: "1. Beta",
                  newHeading: "1.1. Beta",
                },
                ...(staleHistory
                  ? [
                      {
                        targetPath: "Target.md",
                        oldHeading: "typing",
                        newHeading: "unfinished",
                      },
                    ]
                  : []),
              ],
            },
          ],
          remove: async (ids) => {
            removedIntents.push([...ids]);
          },
        },
        execute: async (operation) => {
          executed.push(operation);
          for (const file of operation.files) {
            content.set(
              file.path,
              applyCheckedEdits(content.get(file.path)!, file.edits),
            );
          }
          return {
            kind: "completed",
            operation: {
              ...operation,
              state: "completed",
              completedPaths: operation.files.map((file) => file.path),
            },
          };
        },
        now: () => Date.parse("2026-08-27T00:00:00.000Z"),
      });

      maintenance.schedule("Target.md", "modify");
      maintenance.schedule("Target.md", "modify");
      maintenance.schedule("Target.md", "modify");
      await maintenance.flush();

      expect(executed).toHaveLength(1);
      expect(content.get("Target.md")).toBe("## 1.1. Beta");
      expect(content.get("A.md")).toBe("[[Target#1.1. Beta]]");
      expect(content.get("B.md")).toBe("[Beta](Target.md#1.1.%20Beta)");
      expect(
        executed[0]?.files.map(({ path, role }) => ({ path, role })),
      ).toEqual([
        { path: "A.md", role: "link-source" },
        { path: "B.md", role: "link-source" },
      ]);
      expect(reads).toEqual(["Target.md", "A.md", "B.md"]);
      expect(reads).not.toContain("Never.md");
      expect(removedIntents).toEqual(staleHistory ? [] : [["intent-1"]]);
    },
  );

  it("resumes durable rename intents after restart without a new target event", async () => {
    const content = new Map([
      ["Target.md", "## 1. Beta"],
      ["Links.md", "[[Target#Beta]]"],
    ]);
    const intents = [
      {
        id: "intent-restart",
        createdAt: "2026-08-31T00:00:00.000Z",
        targetPath: "Target.md",
        renames: [
          {
            targetPath: "Target.md",
            oldHeading: "Beta",
            newHeading: "1. Beta",
          },
        ],
      },
    ];
    const removed: string[][] = [];
    const { journal } = journalHarness();
    const maintenance = new AutomaticMaintenance({
      settings: () => ({ ...DEFAULT_STORED_SETTINGS, mode: "persisted" }),
      read: async (path) => content.get(path)!,
      indexReady: () => true,
      candidates: () => ["Links.md"],
      resolveTarget: () => ({ kind: "file", path: "Target.md" }),
      operationDependencies: {
        createId: () => "resume-intent-operation",
        now: () => "2026-08-31T00:00:01.000Z",
        hashText: async (text) => `hash:${text}`,
      },
      journal,
      renameIntents: {
        list: (targetPath) =>
          intents.filter(
            (intent) =>
              targetPath === undefined || intent.targetPath === targetPath,
          ),
        remove: async (ids) => {
          removed.push([...ids]);
        },
      },
      execute: async (operation) => {
        for (const file of operation.files) {
          content.set(
            file.path,
            applyCheckedEdits(content.get(file.path)!, file.edits),
          );
        }
        return {
          kind: "completed",
          operation: {
            ...operation,
            state: "completed",
            completedPaths: operation.files.map((file) => file.path),
          },
        };
      },
      now: () => Date.parse("2026-08-31T00:00:01.000Z"),
    });

    await maintenance.resume();

    expect(content.get("Links.md")).toBe("[[Target#1. Beta]]");
    expect(removed).toEqual([["intent-restart"]]);
  });

  it("persists retry state and resumes it after restart", async () => {
    const content = new Map([
      ["Target.md", "## 1. Alpha"],
      ["Links.md", "[[Target#Alpha]]"],
    ]);
    const state = journalHarness();
    const intents = [
      {
        id: "intent-retry",
        createdAt: "2026-08-31T00:00:00.000Z",
        targetPath: "Target.md",
        renames: [
          {
            targetPath: "Target.md",
            oldHeading: "Alpha",
            newHeading: "1. Alpha",
          },
        ],
      },
    ];
    let executions = 0;
    const dependencies = {
      settings: () => ({
        ...DEFAULT_STORED_SETTINGS,
        mode: "persisted" as const,
      }),
      read: async (path: string) => content.get(path)!,
      indexReady: () => true,
      candidates: () => ["Links.md"],
      resolveTarget: () => ({ kind: "file" as const, path: "Target.md" }),
      operationDependencies: {
        createId: () => "retry-1",
        now: () => "2026-08-27T00:00:00.000Z",
        hashText: async (text: string) => `hash:${text}`,
      },
      journal: state.journal,
      renameIntents: {
        list: (targetPath?: string) =>
          intents.filter(
            (intent) =>
              targetPath === undefined || intent.targetPath === targetPath,
          ),
        remove: async (ids: readonly string[]) => {
          for (const id of ids) {
            const index = intents.findIndex((intent) => intent.id === id);
            if (index >= 0) intents.splice(index, 1);
          }
        },
      },
      execute: async (operation: PersistedOperation) => {
        executions += 1;
        if (executions === 1) {
          return {
            kind: "recovery-required" as const,
            code: "write-error",
            operation: { ...operation, state: "recovery-required" as const },
          };
        }
        for (const file of operation.files) {
          content.set(
            file.path,
            applyCheckedEdits(content.get(file.path)!, file.edits),
          );
        }
        return {
          kind: "completed" as const,
          operation: {
            ...operation,
            state: "completed" as const,
            completedPaths: operation.files.map((file) => file.path),
          },
        };
      },
    };
    const first = new AutomaticMaintenance({
      ...dependencies,
      now: () => Date.parse("2026-08-27T00:00:00.000Z"),
    });
    first.schedule("Target.md", "modify");
    await first.flush();

    expect(state.pending.get("retry-1")?.retry).toMatchObject({
      attempts: 1,
      diagnosticCode: "write-error",
    });
    first.dispose();

    const restarted = new AutomaticMaintenance({
      ...dependencies,
      now: () => Date.parse("2026-08-27T00:00:02.000Z"),
    });
    await restarted.resume();

    expect(executions).toBe(2);
    expect(state.pending.size).toBe(0);
    expect(intents).toEqual([]);
  });
});

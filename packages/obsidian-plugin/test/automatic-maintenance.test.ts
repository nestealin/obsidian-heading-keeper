import { describe, expect, it } from "vitest";
import { DEFAULT_STORED_SETTINGS } from "../src/settings.js";
import { AutomaticMaintenance } from "../src/automatic-maintenance.js";
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
  it("coalesces rapid saves and reads only reverse-index candidates", async () => {
    const content = new Map([
      ["Target.md", "## Alpha"],
      ["A.md", "[[Target#Beta]]"],
      ["B.md", "[Beta](Target.md#Beta)"],
      ["Never.md", "private unrelated body"],
    ]);
    const reads: string[] = [];
    const executed: PersistedOperation[] = [];
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
    content.set("Target.md", "## Intermediate");
    maintenance.schedule("Target.md", "modify");
    content.set("Target.md", "## Beta");
    maintenance.schedule("Target.md", "modify");
    await maintenance.flush();

    expect(executed).toHaveLength(1);
    expect(content.get("Target.md")).toBe("## 1. Beta");
    expect(reads).toEqual(["Target.md", "A.md", "B.md"]);
    expect(reads).not.toContain("Never.md");
  });

  it("persists retry state and resumes it after restart", async () => {
    const content = new Map([["Target.md", "## Alpha"]]);
    const state = journalHarness();
    let executions = 0;
    const dependencies = {
      settings: () => ({
        ...DEFAULT_STORED_SETTINGS,
        mode: "persisted" as const,
      }),
      read: async (path: string) => content.get(path)!,
      indexReady: () => true,
      candidates: () => [],
      resolveTarget: () => ({ kind: "file" as const, path: "Target.md" }),
      operationDependencies: {
        createId: () => "retry-1",
        now: () => "2026-08-27T00:00:00.000Z",
        hashText: async (text: string) => `hash:${text}`,
      },
      journal: state.journal,
      execute: async (operation: PersistedOperation) => {
        executions += 1;
        return executions === 1
          ? {
              kind: "recovery-required" as const,
              code: "write-error",
              operation: { ...operation, state: "recovery-required" as const },
            }
          : {
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
  });
});

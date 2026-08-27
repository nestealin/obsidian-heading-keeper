import { describe, expect, it } from "vitest";
import {
  applySummaryRetention,
  DEFAULT_RETENTION_POLICY,
} from "../src/persistence/retention.js";
import type { OperationSummary } from "../src/persistence/types.js";

function summary(id: string, completedAt: string): OperationSummary {
  return {
    id,
    createdAt: completedAt,
    completedAt,
    state: "completed",
    fileCount: 1,
    editCount: 1,
    diagnosticCode: null,
  };
}

describe("operation summary retention", () => {
  it("keeps only the fifty newest summaries", () => {
    const summaries = Array.from({ length: 55 }, (_, index) =>
      summary(
        `op-${index.toString().padStart(2, "0")}`,
        new Date(Date.UTC(2026, 7, 27, 0, index)).toISOString(),
      ),
    );

    const retained = applySummaryRetention(
      summaries,
      Date.UTC(2026, 7, 27, 1),
      DEFAULT_RETENTION_POLICY,
    );

    expect(retained).toHaveLength(50);
    expect(retained[0]?.id).toBe("op-05");
    expect(retained.at(-1)?.id).toBe("op-54");
  });

  it("removes summaries older than seven days", () => {
    const now = Date.UTC(2026, 7, 27);
    const retained = applySummaryRetention(
      [
        summary("expired", new Date(now - 7 * 86_400_000 - 1).toISOString()),
        summary("boundary", new Date(now - 7 * 86_400_000).toISOString()),
      ],
      now,
      DEFAULT_RETENTION_POLICY,
    );

    expect(retained.map(({ id }) => id)).toEqual(["boundary"]);
  });
});

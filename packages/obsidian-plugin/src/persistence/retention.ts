import type { OperationSummary } from "./types.js";

export interface RetentionPolicy {
  readonly maxSummaries: number;
  readonly maxAgeMs: number;
  readonly maxBytes: number;
}

export const DEFAULT_RETENTION_POLICY: Readonly<RetentionPolicy> =
  Object.freeze({
    maxSummaries: 50,
    maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
    maxBytes: 1_048_576,
  });

export function applySummaryRetention(
  summaries: readonly OperationSummary[],
  nowMs: number,
  policy: RetentionPolicy = DEFAULT_RETENTION_POLICY,
): OperationSummary[] {
  const oldestAllowed = nowMs - policy.maxAgeMs;
  return summaries
    .filter((summary) => {
      const completedAt = Date.parse(summary.completedAt);
      return Number.isFinite(completedAt) && completedAt >= oldestAllowed;
    })
    .sort(
      (left, right) =>
        left.completedAt.localeCompare(right.completedAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(-policy.maxSummaries)
    .map((summary) => ({ ...summary }));
}

export function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

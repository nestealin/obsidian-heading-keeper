import { scanHeadings } from "./scanner.js";
import type {
  NumberingPlan,
  NumberingPlanEntry,
  SourceRange,
  TextEdit,
} from "./types.js";

export type StalePlanCode =
  | "out-of-bounds"
  | "range-mismatch"
  | "overlapping-edit"
  | "unsafe-edit"
  | "missing-edit"
  | "missing-heading"
  | "heading-mismatch"
  | "stale-text";

export class StalePlanError extends Error {
  readonly code: StalePlanCode;
  readonly entryIndex?: number;

  constructor(code: StalePlanCode, message: string, entryIndex?: number) {
    super(message);
    this.name = "StalePlanError";
    this.code = code;
    if (entryIndex !== undefined) {
      this.entryIndex = entryIndex;
    }
  }
}

interface IndexedRange {
  range: SourceRange;
  entryIndex: number;
}

interface ResolvedEdit extends IndexedRange {
  replacementText: string;
}

function isRangeInBounds(range: SourceRange, length: number): boolean {
  return (
    Number.isInteger(range.from) &&
    Number.isInteger(range.to) &&
    range.from >= 0 &&
    range.to >= range.from &&
    range.to <= length
  );
}

function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
  if (
    left.from === left.to &&
    right.from === right.to &&
    left.from === right.from
  ) {
    return true;
  }
  return left.from < right.to && right.from < left.to;
}

function assertNoOverlap(ranges: readonly IndexedRange[]): void {
  const sorted = [...ranges].sort(
    (left, right) =>
      left.range.from - right.range.from || left.range.to - right.range.to,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current && rangesOverlap(previous.range, current.range)) {
      throw new StalePlanError(
        "overlapping-edit",
        `Plan entries ${previous.entryIndex} and ${current.entryIndex} overlap.`,
        current.entryIndex,
      );
    }
  }
}

function validateEntryRanges(
  entry: NumberingPlanEntry,
  markdownLength: number,
  entryIndex: number,
): void {
  const { sourceRange, contentRange } = entry.heading;
  if (
    !isRangeInBounds(sourceRange, markdownLength) ||
    !isRangeInBounds(contentRange, markdownLength) ||
    contentRange.from < sourceRange.from ||
    contentRange.to > sourceRange.to ||
    (entry.edit && !isRangeInBounds(entry.edit.range, markdownLength))
  ) {
    throw new StalePlanError(
      "out-of-bounds",
      `Plan entry ${entryIndex} contains an out-of-bounds range.`,
      entryIndex,
    );
  }
}

function validateEditContract(
  entry: NumberingPlanEntry,
  entryIndex: number,
): TextEdit | undefined {
  const changesText = entry.action === "insert" || entry.action === "replace";
  if (changesText && !entry.edit) {
    throw new StalePlanError(
      "missing-edit",
      `Plan entry ${entryIndex} has action ${entry.action} without an edit.`,
      entryIndex,
    );
  }
  if (!changesText && entry.edit) {
    throw new StalePlanError(
      "unsafe-edit",
      `Plan entry ${entryIndex} has action ${entry.action} with an edit.`,
      entryIndex,
    );
  }
  if (!entry.edit) {
    return undefined;
  }
  if (
    entry.edit.range.from !== entry.heading.contentRange.from ||
    entry.edit.range.to !== entry.heading.contentRange.to
  ) {
    throw new StalePlanError(
      "range-mismatch",
      `Plan entry ${entryIndex} edit range does not match its heading content range.`,
      entryIndex,
    );
  }
  if (entry.edit.expectedText !== entry.heading.rawText) {
    throw new StalePlanError(
      "stale-text",
      `Plan entry ${entryIndex} edit precondition does not match its scanned heading.`,
      entryIndex,
    );
  }
  if (entry.action === "insert") {
    const expectedText = entry.edit.expectedText;
    const replacementText = entry.edit.replacementText;
    const insertedLength = replacementText.length - expectedText.length;
    const insertedText = replacementText.slice(0, insertedLength);
    if (
      entry.ownership !== "absent" ||
      insertedLength <= entry.displayPrefix.length ||
      !replacementText.endsWith(expectedText) ||
      !insertedText.startsWith(entry.displayPrefix)
    ) {
      throw new StalePlanError(
        "unsafe-edit",
        `Plan entry ${entryIndex} is not a conservative prefix insertion.`,
        entryIndex,
      );
    }
  }
  if (entry.action === "replace" && entry.ownership !== "exact") {
    throw new StalePlanError(
      "unsafe-edit",
      `Plan entry ${entryIndex} cannot replace an unowned numeric candidate.`,
      entryIndex,
    );
  }
  return entry.edit;
}

export function applyPlan(markdown: string, plan: NumberingPlan): string {
  const plannedEdits: IndexedRange[] = [];

  for (let index = 0; index < plan.entries.length; index += 1) {
    const entry = plan.entries[index];
    if (!entry) {
      continue;
    }
    validateEntryRanges(entry, markdown.length, index);
    const edit = validateEditContract(entry, index);
    if (edit) {
      plannedEdits.push({ range: edit.range, entryIndex: index });
    }
  }
  assertNoOverlap(plannedEdits);

  const currentByLine = new Map(
    scanHeadings(markdown).map((heading) => [heading.line, heading]),
  );
  const edits: ResolvedEdit[] = [];

  for (let index = 0; index < plan.entries.length; index += 1) {
    const entry = plan.entries[index];
    if (!entry || !entry.edit) {
      continue;
    }

    const current = currentByLine.get(entry.heading.line);
    if (!current) {
      throw new StalePlanError(
        "missing-heading",
        `Plan entry ${index} no longer points to a heading.`,
        index,
      );
    }
    if (current.level !== entry.heading.level) {
      throw new StalePlanError(
        "heading-mismatch",
        `Plan entry ${index} heading level changed.`,
        index,
      );
    }
    if (current.rawText === entry.edit.replacementText) {
      continue;
    }
    if (current.rawText !== entry.edit.expectedText) {
      throw new StalePlanError(
        "stale-text",
        `Plan entry ${index} heading text changed.`,
        index,
      );
    }
    edits.push({
      range: current.contentRange,
      replacementText: entry.edit.replacementText,
      entryIndex: index,
    });
  }

  assertNoOverlap(edits);

  let result = markdown;
  for (const edit of edits.sort(
    (left, right) => right.range.from - left.range.from,
  )) {
    result =
      result.slice(0, edit.range.from) +
      edit.replacementText +
      result.slice(edit.range.to);
  }
  return result;
}

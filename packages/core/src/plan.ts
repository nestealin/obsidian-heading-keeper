import { scanHeadings } from "./scanner.js";
import { classifyOwnership } from "./ownership.js";
import type {
  NumberingFormat,
  NumberingPlan,
  NumberingPlanEntry,
  SourceRange,
  TextEdit,
} from "./types.js";

export type StalePlanCode =
  | "out-of-bounds"
  | "invalid-format"
  | "invalid-segments"
  | "invalid-skip"
  | "prefix-mismatch"
  | "ownership-mismatch"
  | "range-mismatch"
  | "overlapping-edit"
  | "unsafe-edit"
  | "missing-edit"
  | "missing-heading"
  | "heading-mismatch"
  | "duplicate-target"
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

function isSingleLineString(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && !/[\r\n]/u.test(value)
  );
}

function validatedFormat(format: unknown): Readonly<NumberingFormat> {
  try {
    if (
      typeof format === "object" &&
      format !== null &&
      isSingleLineString(
        (format as { numberSeparator?: unknown }).numberSeparator,
      ) &&
      isSingleLineString(
        (format as { titleSeparator?: unknown }).titleSeparator,
      )
    ) {
      return format as NumberingFormat;
    }
  } catch {
    // An untrusted format accessor is invalid.
  }
  throw new StalePlanError(
    "invalid-format",
    "Numbering plan format must contain non-empty single-line separators.",
  );
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

function validateEntryIntegrity(
  entry: NumberingPlanEntry,
  format: Readonly<NumberingFormat>,
  entryIndex: number,
): void {
  if (
    !Array.isArray(entry.segments) ||
    entry.segments.some(
      (segment) => !Number.isSafeInteger(segment) || segment < 0,
    ) ||
    (entry.action !== "skip" && entry.segments.length === 0)
  ) {
    throw new StalePlanError(
      "invalid-segments",
      `Plan entry ${entryIndex} contains invalid numbering segments.`,
      entryIndex,
    );
  }

  if (
    entry.action === "skip" &&
    (entry.segments.length !== 0 || entry.displayPrefix !== "")
  ) {
    throw new StalePlanError(
      "invalid-skip",
      `Plan entry ${entryIndex} skip action must have empty numbering data.`,
      entryIndex,
    );
  }

  const expectedPrefix = entry.segments.join(format.numberSeparator);
  if (
    typeof entry.displayPrefix !== "string" ||
    entry.displayPrefix !== expectedPrefix
  ) {
    throw new StalePlanError(
      "prefix-mismatch",
      `Plan entry ${entryIndex} display prefix is not derived from its segments.`,
      entryIndex,
    );
  }

  const ownership = classifyOwnership(
    entry.heading,
    entry.displayPrefix,
    format,
  );
  if (entry.ownership !== ownership) {
    throw new StalePlanError(
      "ownership-mismatch",
      `Plan entry ${entryIndex} ownership does not match its original heading.`,
      entryIndex,
    );
  }

  if (
    entry.action === "replace" ||
    entry.action === "decorate" ||
    (entry.action === "insert" && ownership !== "absent") ||
    (entry.action === "preserve" && ownership === "absent")
  ) {
    throw new StalePlanError(
      "unsafe-edit",
      `Plan entry ${entryIndex} action is not valid for its verified ownership.`,
      entryIndex,
    );
  }
}

function validateEditContract(
  entry: NumberingPlanEntry,
  format: Readonly<NumberingFormat>,
  entryIndex: number,
): TextEdit | undefined {
  const changesText = entry.action === "insert";
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
  const expectedReplacement = `${entry.displayPrefix}${format.titleSeparator}${entry.edit.expectedText}`;
  if (entry.edit.replacementText !== expectedReplacement) {
    throw new StalePlanError(
      "unsafe-edit",
      `Plan entry ${entryIndex} is not an exact conservative prefix insertion.`,
      entryIndex,
    );
  }
  return entry.edit;
}

export function applyPlan(markdown: string, plan: NumberingPlan): string {
  const format = validatedFormat(plan.format);
  const plannedEdits: IndexedRange[] = [];
  const plannedTargets = new Set<string>();

  for (let index = 0; index < plan.entries.length; index += 1) {
    const entry = plan.entries[index];
    if (!entry) {
      continue;
    }
    const target = `${entry.heading.line}:${entry.heading.level}`;
    if (plannedTargets.has(target)) {
      throw new StalePlanError(
        "duplicate-target",
        `Plan entry ${index} repeats heading target ${target}.`,
        index,
      );
    }
    plannedTargets.add(target);
    validateEntryRanges(entry, markdown.length, index);
    validateEntryIntegrity(entry, format, index);
    const edit = validateEditContract(entry, format, index);
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
    if (!entry) {
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
    if (!entry.edit) {
      if (current.rawText !== entry.heading.rawText) {
        throw new StalePlanError(
          "stale-text",
          `Plan entry ${index} heading text changed.`,
          index,
        );
      }
      continue;
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

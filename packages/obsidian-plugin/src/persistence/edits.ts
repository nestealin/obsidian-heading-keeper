import type { PlannedTextEdit } from "./types.js";

export type CheckedEditErrorCode =
  | "range-invalid"
  | "expected-text-mismatch"
  | "edit-overlap";

export class CheckedEditError extends Error {
  readonly name = "CheckedEditError";

  constructor(readonly code: CheckedEditErrorCode) {
    super(code);
  }
}

export function copyEdit(edit: PlannedTextEdit): PlannedTextEdit {
  return {
    range: { from: edit.range.from, to: edit.range.to },
    expectedText: edit.expectedText,
    replacementText: edit.replacementText,
  };
}

export function orderedCheckedEdits(
  text: string,
  edits: readonly PlannedTextEdit[],
): PlannedTextEdit[] {
  const ordered = edits
    .map(copyEdit)
    .sort(
      (left, right) =>
        left.range.from - right.range.from || left.range.to - right.range.to,
    );
  for (let index = 0; index < ordered.length; index += 1) {
    const edit = ordered[index]!;
    const { from, to } = edit.range;
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to < from ||
      to > text.length
    ) {
      throw new CheckedEditError("range-invalid");
    }
    if (text.slice(from, to) !== edit.expectedText) {
      throw new CheckedEditError("expected-text-mismatch");
    }
    const previous = ordered[index - 1];
    if (
      previous &&
      (from < previous.range.to ||
        (from === to &&
          previous.range.from === previous.range.to &&
          from === previous.range.from))
    ) {
      throw new CheckedEditError("edit-overlap");
    }
  }
  return ordered;
}

export function applyCheckedEdits(
  text: string,
  edits: readonly PlannedTextEdit[],
): string {
  const ordered = orderedCheckedEdits(text, edits);
  let result = text;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const edit = ordered[index]!;
    result =
      result.slice(0, edit.range.from) +
      edit.replacementText +
      result.slice(edit.range.to);
  }
  return result;
}

export function invertEdits(
  beforeText: string,
  edits: readonly PlannedTextEdit[],
): PlannedTextEdit[] {
  const ordered = orderedCheckedEdits(beforeText, edits);
  let delta = 0;
  return ordered.map((edit) => {
    const from = edit.range.from + delta;
    const inverse = {
      range: { from, to: from + edit.replacementText.length },
      expectedText: edit.replacementText,
      replacementText: edit.expectedText,
    };
    delta += edit.replacementText.length - edit.expectedText.length;
    return inverse;
  });
}

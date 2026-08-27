import { describe, expect, it } from "vitest";
import {
  applyCheckedEdits,
  CheckedEditError,
  invertEdits,
} from "../src/persistence/edits.js";

describe("checked persistence edits", () => {
  it("applies non-overlapping edits and inverts them without storing a body", () => {
    const before = "## Alpha\n[[#Alpha]]";
    const edits = [
      {
        range: { from: 3, to: 3 },
        expectedText: "",
        replacementText: "1. ",
      },
      {
        range: { from: 9, to: 19 },
        expectedText: "[[#Alpha]]",
        replacementText: "[[#1. Alpha]]",
      },
    ];
    const after = applyCheckedEdits(before, edits);

    expect(after).toBe("## 1. Alpha\n[[#1. Alpha]]");
    expect(applyCheckedEdits(after, invertEdits(before, edits))).toBe(before);
  });

  it("rejects stale expected text instead of overwriting it", () => {
    expect(() =>
      applyCheckedEdits("external", [
        {
          range: { from: 0, to: 5 },
          expectedText: "known",
          replacementText: "new",
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<CheckedEditError>>({
        code: "expected-text-mismatch",
      }),
    );
  });
});

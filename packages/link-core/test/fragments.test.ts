import { describe, expect, it } from "vitest";
import { normalizeHeadingFragment } from "../src/index.js";

describe("normalizeHeadingFragment", () => {
  it("decodes percent encoding exactly once and applies NFC", () => {
    expect(normalizeHeadingFragment("Old%2520Cafe%CC%81")).toEqual({
      ok: true,
      value: "Old%20Café",
    });
  });

  it.each([
    ["Old heading", "Old heading"],
    ["Old%20heading", "Old heading"],
    ["Caf%C3%A9 标题", "Café 标题"],
    ["Cafe%CC%81%20标题", "Café 标题"],
    ["Old%2520heading", "Old%20heading"],
  ])("normalizes %s to the literal identity %s", (raw, expected) => {
    expect(normalizeHeadingFragment(raw)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each(["Bad%", "Bad%2", "Bad%GG", "%E0%A4%A"])(
    "reports malformed encoding for %s without throwing",
    (raw) => {
      expect(() => normalizeHeadingFragment(raw)).not.toThrow();
      expect(normalizeHeadingFragment(raw)).toEqual({
        ok: false,
        code: "malformed-percent-encoding",
      });
    },
  );
});

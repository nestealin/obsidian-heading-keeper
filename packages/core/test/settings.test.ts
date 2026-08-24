import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSettings } from "../src/index.js";

const validSettings = {
  topLevel: 2,
  bottomLevel: 6,
  startAt: 1,
  numberSeparator: ".",
  titleSeparator: ". ",
  gapStrategy: "compact",
} as const;

function expectInvalid(input: unknown, field: string): void {
  const result = validateSettings(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((error) => error.field === field)).toBe(true);
  }
}

describe("DEFAULT_SETTINGS", () => {
  it("defaults to virtual-compatible H2 through H6 numbering", () => {
    expect(DEFAULT_SETTINGS).toEqual(validSettings);
  });

  it("does not expose a mutable default value through validation", () => {
    const first = validateSettings(validSettings);
    const second = validateSettings(validSettings);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value).not.toBe(second.value);
      first.value.topLevel = 4;
      expect(second.value.topLevel).toBe(2);
      expect(DEFAULT_SETTINGS.topLevel).toBe(2);
    }
  });
});

describe("validateSettings", () => {
  it("returns a normalized copy for a complete valid configuration", () => {
    const result = validateSettings({ ...validSettings });

    expect(result).toEqual({ ok: true, value: validSettings });
    if (result.ok) {
      expect(result.value).not.toBe(validSettings);
    }
  });

  it("reports a field error for a non-object input without throwing", () => {
    expectInvalid(null, "settings");
    expectInvalid([], "settings");
    expectInvalid("not settings", "settings");
  });

  it("reports every missing required field", () => {
    const result = validateSettings({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.field)).toEqual([
        "topLevel",
        "bottomLevel",
        "startAt",
        "numberSeparator",
        "titleSeparator",
        "gapStrategy",
      ]);
    }
  });

  it("rejects topLevel outside the H1 through H6 range", () => {
    expectInvalid({ ...validSettings, topLevel: 0 }, "topLevel");
    expectInvalid({ ...validSettings, topLevel: 7 }, "topLevel");
  });

  it("rejects bottomLevel outside the H1 through H6 range", () => {
    expectInvalid({ ...validSettings, bottomLevel: 0 }, "bottomLevel");
    expectInvalid({ ...validSettings, bottomLevel: 7 }, "bottomLevel");
  });

  it("rejects a level range whose top is below its bottom", () => {
    expectInvalid({ ...validSettings, topLevel: 5, bottomLevel: 3 }, "topLevel");
    expectInvalid({ ...validSettings, topLevel: 5, bottomLevel: 3 }, "bottomLevel");
  });

  it("rejects a startAt value that is not a non-negative integer", () => {
    expectInvalid({ ...validSettings, startAt: -1 }, "startAt");
    expectInvalid({ ...validSettings, startAt: 1.5 }, "startAt");
    expectInvalid({ ...validSettings, startAt: "1" }, "startAt");
  });

  it("rejects non-string and multiline number separators", () => {
    expectInvalid({ ...validSettings, numberSeparator: 1 }, "numberSeparator");
    expectInvalid({ ...validSettings, numberSeparator: ".\n" }, "numberSeparator");
    expectInvalid({ ...validSettings, numberSeparator: ".\r" }, "numberSeparator");
  });

  it("rejects non-string and multiline title separators", () => {
    expectInvalid({ ...validSettings, titleSeparator: 1 }, "titleSeparator");
    expectInvalid({ ...validSettings, titleSeparator: ".\n" }, "titleSeparator");
    expectInvalid({ ...validSettings, titleSeparator: ".\r" }, "titleSeparator");
  });

  it("accepts each supported gap strategy and rejects unsupported values", () => {
    for (const gapStrategy of ["zero-fill", "one-fill", "compact", "skip"] as const) {
      expect(validateSettings({ ...validSettings, gapStrategy }).ok).toBe(true);
    }
    expectInvalid({ ...validSettings, gapStrategy: "preserve" }, "gapStrategy");
    expectInvalid({ ...validSettings, gapStrategy: 1 }, "gapStrategy");
  });
});

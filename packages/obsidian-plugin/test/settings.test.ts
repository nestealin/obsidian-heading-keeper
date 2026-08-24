import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORED_SETTINGS,
  validateStoredSettings,
} from "../src/settings.js";

describe("plugin stored settings", () => {
  it("defaults to virtual-compatible core settings and Auto language", () => {
    expect(DEFAULT_STORED_SETTINGS).toEqual({
      topLevel: 2,
      bottomLevel: 6,
      startAt: 1,
      numberSeparator: ".",
      titleSeparator: ". ",
      gapStrategy: "compact",
      locale: "auto",
    });
  });

  it("keeps core field errors stable for invalid persisted settings", () => {
    const result = validateStoredSettings({
      ...DEFAULT_STORED_SETTINGS,
      topLevel: 0,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "topLevel", message: "Expected an integer from 1 through 6." },
      ],
    });
  });

  it("reports an invalid language preference as a locale field error", () => {
    const result = validateStoredSettings({
      ...DEFAULT_STORED_SETTINGS,
      locale: "fr",
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "locale", message: "Expected auto, en, or zh." }],
    });
  });
});

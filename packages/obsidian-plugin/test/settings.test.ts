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
      mode: "virtual",
      locale: "auto",
      updateHeadingLinks: true,
    });
  });

  it("migrates legacy settings without a link-sync field to enabled", () => {
    const { updateHeadingLinks: _removed, ...legacy } = DEFAULT_STORED_SETTINGS;

    expect(validateStoredSettings(legacy)).toEqual({
      ok: true,
      value: { ...DEFAULT_STORED_SETTINGS, updateHeadingLinks: true },
    });
  });

  it("keeps link synchronization independently configurable and rejects invalid values", () => {
    expect(
      validateStoredSettings({
        ...DEFAULT_STORED_SETTINGS,
        updateHeadingLinks: false,
      }),
    ).toEqual({
      ok: true,
      value: { ...DEFAULT_STORED_SETTINGS, updateHeadingLinks: false },
    });
    expect(
      validateStoredSettings({
        ...DEFAULT_STORED_SETTINGS,
        updateHeadingLinks: "yes",
      }),
    ).toEqual({
      ok: false,
      errors: [
        {
          field: "updateHeadingLinks",
          message: "Expected a boolean.",
        },
      ],
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

  it("keeps an explicit persisted mode and rejects invalid modes", () => {
    expect(
      validateStoredSettings({
        ...DEFAULT_STORED_SETTINGS,
        mode: "persisted",
      }),
    ).toEqual({
      ok: true,
      value: { ...DEFAULT_STORED_SETTINGS, mode: "persisted" },
    });

    expect(
      validateStoredSettings({
        ...DEFAULT_STORED_SETTINGS,
        mode: "background",
      }),
    ).toEqual({
      ok: false,
      errors: [{ field: "mode", message: "Expected virtual or persisted." }],
    });
  });
});

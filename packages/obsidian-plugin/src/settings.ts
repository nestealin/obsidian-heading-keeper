import {
  DEFAULT_SETTINGS,
  validateSettings,
  type FieldError,
  type NumberingSettings,
} from "@heading-numbering/core";
import type { LocalePreference } from "./i18n.js";

export type NumberingMode = "virtual" | "persisted";

export interface StoredSettings extends NumberingSettings {
  mode: NumberingMode;
  locale: LocalePreference;
}

export type StoredSettingsValidation =
  | { ok: true; value: StoredSettings }
  | { ok: false; errors: FieldError[] };

export const DEFAULT_STORED_SETTINGS: Readonly<StoredSettings> = Object.freeze({
  ...DEFAULT_SETTINGS,
  mode: "virtual",
  locale: "auto",
});

function readOwnValue(input: unknown, field: string): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor || !("value" in descriptor)) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

function readOwnLocale(input: unknown): LocalePreference | undefined {
  const value = readOwnValue(input, "locale");
  return value === "auto" || value === "en" || value === "zh"
    ? value
    : undefined;
}

function readOwnMode(input: unknown): NumberingMode | undefined {
  const value = readOwnValue(input, "mode");
  return value === "virtual" || value === "persisted" ? value : undefined;
}

export function validateStoredSettings(
  input: unknown,
): StoredSettingsValidation {
  const numbering = validateSettings(input);
  if (!numbering.ok) {
    return numbering;
  }

  const mode = readOwnMode(input);
  if (!mode) {
    return {
      ok: false,
      errors: [{ field: "mode", message: "Expected virtual or persisted." }],
    };
  }

  const locale = readOwnLocale(input);
  if (!locale) {
    return {
      ok: false,
      errors: [{ field: "locale", message: "Expected auto, en, or zh." }],
    };
  }

  return { ok: true, value: { ...numbering.value, mode, locale } };
}

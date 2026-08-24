import {
  DEFAULT_SETTINGS,
  validateSettings,
  type FieldError,
  type NumberingSettings,
} from "@heading-numbering/core";
import type { LocalePreference } from "./i18n.js";

export interface StoredSettings extends NumberingSettings {
  locale: LocalePreference;
}

export type StoredSettingsValidation =
  | { ok: true; value: StoredSettings }
  | { ok: false; errors: FieldError[] };

export const DEFAULT_STORED_SETTINGS: Readonly<StoredSettings> = Object.freeze({
  ...DEFAULT_SETTINGS,
  locale: "auto",
});

function readOwnLocale(input: unknown): LocalePreference | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, "locale");
    if (!descriptor || !("value" in descriptor)) {
      return undefined;
    }
    const value = descriptor.value;
    return value === "auto" || value === "en" || value === "zh"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function validateStoredSettings(
  input: unknown,
): StoredSettingsValidation {
  const numbering = validateSettings(input);
  if (!numbering.ok) {
    return numbering;
  }

  const locale = readOwnLocale(input);
  if (!locale) {
    return {
      ok: false,
      errors: [{ field: "locale", message: "Expected auto, en, or zh." }],
    };
  }

  return { ok: true, value: { ...numbering.value, locale } };
}

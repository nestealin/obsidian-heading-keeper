import type {
  FieldError,
  GapStrategy,
  HeadingLevel,
  NumberingSettings,
  SettingsValidation,
} from "./types.js";

export const DEFAULT_SETTINGS: Readonly<NumberingSettings> = Object.freeze({
  topLevel: 2,
  bottomLevel: 6,
  startAt: 1,
  numberSeparator: ".",
  titleSeparator: ". ",
  gapStrategy: "compact",
});

const gapStrategies: readonly GapStrategy[] = ["compact", "preserve"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeadingLevel(value: unknown): value is HeadingLevel {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 6
  );
}

function isSingleLineString(value: unknown): value is string {
  return typeof value === "string" && !/[\r\n]/u.test(value);
}

function hasGapStrategy(value: unknown): value is GapStrategy {
  return typeof value === "string" && gapStrategies.includes(value as GapStrategy);
}

export function validateSettings(input: unknown): SettingsValidation {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ field: "settings", message: "Expected a settings object." }],
    };
  }

  const errors: FieldError[] = [];
  const { topLevel, bottomLevel, startAt, numberSeparator, titleSeparator, gapStrategy } =
    input;

  if (!isHeadingLevel(topLevel)) {
    errors.push({ field: "topLevel", message: "Expected an integer from 1 through 6." });
  }
  if (!isHeadingLevel(bottomLevel)) {
    errors.push({
      field: "bottomLevel",
      message: "Expected an integer from 1 through 6.",
    });
  }
  if (isHeadingLevel(topLevel) && isHeadingLevel(bottomLevel) && topLevel > bottomLevel) {
    errors.push({
      field: "topLevel",
      message: "Must not be greater than bottomLevel.",
    });
    errors.push({
      field: "bottomLevel",
      message: "Must not be less than topLevel.",
    });
  }
  if (typeof startAt !== "number" || !Number.isInteger(startAt) || startAt < 0) {
    errors.push({ field: "startAt", message: "Expected a non-negative integer." });
  }
  if (!isSingleLineString(numberSeparator)) {
    errors.push({ field: "numberSeparator", message: "Expected a single-line string." });
  }
  if (!isSingleLineString(titleSeparator)) {
    errors.push({ field: "titleSeparator", message: "Expected a single-line string." });
  }
  if (!hasGapStrategy(gapStrategy)) {
    errors.push({ field: "gapStrategy", message: "Expected a supported gap strategy." });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (
    !isHeadingLevel(topLevel) ||
    !isHeadingLevel(bottomLevel) ||
    typeof startAt !== "number" ||
    !Number.isInteger(startAt) ||
    startAt < 0 ||
    !isSingleLineString(numberSeparator) ||
    !isSingleLineString(titleSeparator) ||
    !hasGapStrategy(gapStrategy)
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      topLevel,
      bottomLevel,
      startAt,
      numberSeparator,
      titleSeparator,
      gapStrategy,
    },
  };
}

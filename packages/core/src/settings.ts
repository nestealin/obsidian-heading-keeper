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

const gapStrategies: readonly GapStrategy[] = [
  "zero-fill",
  "one-fill",
  "compact",
  "skip",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
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
  return (
    typeof value === "string" && value.length > 0 && !/[\r\n]/u.test(value)
  );
}

function hasGapStrategy(value: unknown): value is GapStrategy {
  return (
    typeof value === "string" && gapStrategies.includes(value as GapStrategy)
  );
}

function isStartAt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readOwnDataProperty(
  input: object,
  field: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor || !("value" in descriptor)) {
      return { ok: false };
    }
    return { ok: true, value: descriptor.value };
  } catch {
    return { ok: false };
  }
}

export function validateSettings(input: unknown): SettingsValidation {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ field: "settings", message: "Expected a settings object." }],
    };
  }

  const errors: FieldError[] = [];
  const topLevel = readOwnDataProperty(input, "topLevel");
  const bottomLevel = readOwnDataProperty(input, "bottomLevel");
  const startAt = readOwnDataProperty(input, "startAt");
  const numberSeparator = readOwnDataProperty(input, "numberSeparator");
  const titleSeparator = readOwnDataProperty(input, "titleSeparator");
  const gapStrategy = readOwnDataProperty(input, "gapStrategy");

  if (!topLevel.ok || !isHeadingLevel(topLevel.value)) {
    errors.push({
      field: "topLevel",
      message: "Expected an integer from 1 through 6.",
    });
  }
  if (!bottomLevel.ok || !isHeadingLevel(bottomLevel.value)) {
    errors.push({
      field: "bottomLevel",
      message: "Expected an integer from 1 through 6.",
    });
  }
  if (
    topLevel.ok &&
    bottomLevel.ok &&
    isHeadingLevel(topLevel.value) &&
    isHeadingLevel(bottomLevel.value) &&
    topLevel.value > bottomLevel.value
  ) {
    errors.push({
      field: "topLevel",
      message: "Must not be greater than bottomLevel.",
    });
    errors.push({
      field: "bottomLevel",
      message: "Must not be less than topLevel.",
    });
  }
  if (!startAt.ok || !isStartAt(startAt.value)) {
    errors.push({
      field: "startAt",
      message: "Expected a non-negative integer.",
    });
  }
  if (!numberSeparator.ok || !isSingleLineString(numberSeparator.value)) {
    errors.push({
      field: "numberSeparator",
      message: "Expected a single-line string.",
    });
  }
  if (!titleSeparator.ok || !isSingleLineString(titleSeparator.value)) {
    errors.push({
      field: "titleSeparator",
      message: "Expected a single-line string.",
    });
  }
  if (!gapStrategy.ok || !hasGapStrategy(gapStrategy.value)) {
    errors.push({
      field: "gapStrategy",
      message: "Expected a supported gap strategy.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (
    !topLevel.ok ||
    !bottomLevel.ok ||
    !startAt.ok ||
    !numberSeparator.ok ||
    !titleSeparator.ok ||
    !gapStrategy.ok ||
    !isHeadingLevel(topLevel.value) ||
    !isHeadingLevel(bottomLevel.value) ||
    !isStartAt(startAt.value) ||
    !isSingleLineString(numberSeparator.value) ||
    !isSingleLineString(titleSeparator.value) ||
    !hasGapStrategy(gapStrategy.value)
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      topLevel: topLevel.value,
      bottomLevel: bottomLevel.value,
      startAt: startAt.value,
      numberSeparator: numberSeparator.value,
      titleSeparator: titleSeparator.value,
      gapStrategy: gapStrategy.value,
    },
  };
}

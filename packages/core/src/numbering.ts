import type {
  HeadingLevel,
  HeadingNode,
  NumberingPlan,
  NumberingPlanEntry,
  NumberingSettings,
  PlanDiagnostic,
} from "./types.js";
import { analyzeHeadingPrefix, classifyOwnership } from "./ownership.js";

export class NumberingOverflowError extends Error {
  readonly code = "counter-overflow" as const;
  readonly level: HeadingLevel;

  constructor(level: HeadingLevel) {
    super(`Heading level ${level} counter cannot advance safely.`);
    this.name = "NumberingOverflowError";
    this.level = level;
  }
}

function checkedCounter(value: number, level: HeadingLevel): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NumberingOverflowError(level);
  }
  return value;
}

function incrementCounter(counters: number[], level: HeadingLevel): number {
  const current = checkedCounter(counters[level] ?? 0, level);
  const next = current + 1;
  if (!Number.isSafeInteger(next) || next <= current) {
    throw new NumberingOverflowError(level);
  }
  counters[level] = next;
  return next;
}

function compactSectionLevels(
  headings: readonly HeadingNode[],
  settings: NumberingSettings,
): Map<number, ReadonlySet<HeadingLevel>> {
  const sections = new Map<number, ReadonlySet<HeadingLevel>>();

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!heading || heading.level !== settings.topLevel) {
      continue;
    }

    const visibleLevels = new Set<HeadingLevel>([settings.topLevel]);
    for (let cursor = index + 1; cursor < headings.length; cursor += 1) {
      const descendant = headings[cursor];
      if (!descendant || descendant.level <= settings.topLevel) {
        break;
      }
      if (descendant.level <= settings.bottomLevel) {
        visibleLevels.add(descendant.level);
      }
    }
    sections.set(index, visibleLevels);
  }

  return sections;
}

function resetDeeperCounters(
  counters: number[],
  presentLevels: boolean[],
  level: HeadingLevel,
): void {
  for (let cursor = level + 1; cursor <= 6; cursor += 1) {
    counters[cursor] = 0;
    presentLevels[cursor] = false;
  }
}

function buildSegments(
  counters: readonly number[],
  level: HeadingLevel,
  settings: NumberingSettings,
  compactLevels: ReadonlySet<HeadingLevel> | undefined,
): number[] {
  const segments: number[] = [];
  for (let cursor = settings.topLevel; cursor <= level; cursor += 1) {
    const headingLevel = cursor as HeadingLevel;
    if (
      settings.gapStrategy === "compact" &&
      !compactLevels?.has(headingLevel)
    ) {
      continue;
    }

    const value = counters[cursor] ?? 0;
    segments.push(
      settings.gapStrategy === "one-fill" &&
        headingLevel > settings.topLevel &&
        value === 0
        ? 1
        : value,
    );
  }
  return segments;
}

function skippedEntry(
  heading: HeadingNode,
  reason: string,
  format: Readonly<{ numberSeparator: string; titleSeparator: string }>,
): NumberingPlanEntry {
  return {
    heading,
    segments: [],
    displayPrefix: "",
    ownership: classifyOwnership(heading, "", format),
    action: "skip",
    reason,
  };
}

export function buildNumberingPlan(
  headings: readonly HeadingNode[],
  settings: NumberingSettings,
): NumberingPlan {
  const format = Object.freeze({
    numberSeparator: settings.numberSeparator,
    titleSeparator: settings.titleSeparator,
  });
  const compactSections = compactSectionLevels(headings, settings);
  const counters = Array<number>(7).fill(0);
  const presentLevels = Array<boolean>(7).fill(false);
  const entries: NumberingPlanEntry[] = [];
  const diagnostics: PlanDiagnostic[] = [];
  const usedPrefixes = new Set<string>();
  let hasTopLevel = false;
  let currentCompactLevels: ReadonlySet<HeadingLevel> | undefined;

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!heading) {
      continue;
    }

    if (heading.level < settings.topLevel) {
      counters.fill(0);
      presentLevels.fill(false);
      usedPrefixes.clear();
      hasTopLevel = false;
      currentCompactLevels = undefined;
      entries.push(
        skippedEntry(heading, "Heading is above the numbered range.", format),
      );
      continue;
    }

    if (heading.level > settings.bottomLevel) {
      entries.push(
        skippedEntry(heading, "Heading is below the numbered range.", format),
      );
      continue;
    }

    if (heading.level === settings.topLevel) {
      counters[heading.level] = hasTopLevel
        ? incrementCounter(counters, heading.level)
        : checkedCounter(
            Object.is(settings.startAt, -0) ? 0 : settings.startAt,
            heading.level,
          );
      hasTopLevel = true;
      currentCompactLevels = compactSections.get(index);
    } else if (!hasTopLevel) {
      entries.push(
        skippedEntry(heading, "Heading has no top-level section.", format),
      );
      continue;
    } else {
      incrementCounter(counters, heading.level);
    }
    presentLevels[heading.level] = true;
    resetDeeperCounters(counters, presentLevels, heading.level);

    if (
      settings.gapStrategy === "skip" &&
      Array.from(
        { length: heading.level - settings.topLevel },
        (_, offset) => presentLevels[settings.topLevel + offset] ?? false,
      ).some((present) => !present)
    ) {
      const diagnostic: PlanDiagnostic = {
        code: "missing-parent",
        message: "Heading was preserved because a parent level is missing.",
        line: heading.line,
        sourceRange: heading.sourceRange,
      };
      diagnostics.push(diagnostic);
      entries.push(skippedEntry(heading, diagnostic.message, format));
      continue;
    }

    let segments = buildSegments(
      counters,
      heading.level,
      settings,
      currentCompactLevels,
    );
    let displayPrefix = segments.join(settings.numberSeparator);
    while (usedPrefixes.has(displayPrefix)) {
      incrementCounter(counters, heading.level);
      segments = buildSegments(
        counters,
        heading.level,
        settings,
        currentCompactLevels,
      );
      displayPrefix = segments.join(settings.numberSeparator);
    }
    usedPrefixes.add(displayPrefix);
    const analysis = analyzeHeadingPrefix(heading, displayPrefix, format);
    const { ownership } = analysis;
    const reason =
      ownership === "absent"
        ? "Heading has no visible numeric prefix."
        : ownership === "exact"
          ? "Heading already has the computed numeric prefix."
          : ownership === "semantic"
            ? "Heading starts with protected semantic numeric text."
            : ownership === "managed-stale"
              ? "Heading has a stale managed numeric prefix."
              : "Heading starts with an unowned numeric prefix candidate.";

    if (ownership === "ambiguous") {
      diagnostics.push({
        code: "ambiguous-prefix",
        message:
          "Heading was preserved because numeric prefix ownership is ambiguous.",
        line: heading.line,
        sourceRange: heading.sourceRange,
      });
    }
    entries.push({
      heading,
      segments,
      displayPrefix,
      ownership,
      action:
        ownership === "absent" || ownership === "semantic"
          ? "insert"
          : ownership === "managed-stale"
            ? "replace"
            : "preserve",
      reason,
      ...(ownership === "absent" || ownership === "semantic"
        ? {
            edit: {
              range: heading.contentRange,
              expectedText: heading.rawText,
              replacementText: `${displayPrefix}${settings.titleSeparator}${heading.rawText}`,
            },
          }
        : ownership === "managed-stale"
          ? {
              edit: {
                range: heading.contentRange,
                expectedText: heading.rawText,
                replacementText: `${displayPrefix}${settings.titleSeparator}${analysis.logicalTitle}`,
              },
            }
          : {}),
    });
  }

  return { format, entries, diagnostics };
}

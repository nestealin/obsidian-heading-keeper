import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyPlan,
  buildNumberingPlan,
  DEFAULT_SETTINGS,
  NumberingOverflowError,
  scanHeadings,
} from "../src/index.js";
import type {
  GapStrategy,
  HeadingLevel,
  NumberingSettings,
} from "../src/index.js";

const headingLevels = fc.array(
  fc.integer({ min: 1, max: 6 }).map((level) => level as HeadingLevel),
  { minLength: 1, maxLength: 60 },
);

const settings = fc.integer({ min: 1, max: 6 }).chain((topLevel) =>
  fc
    .record({
      bottomLevel: fc.integer({ min: topLevel, max: 6 }),
      startAt: fc.oneof(
        fc.integer({ min: 0, max: 8 }),
        fc.constant(Number.MAX_SAFE_INTEGER - 100),
      ),
      gapStrategy: fc.constantFrom<GapStrategy>(
        "zero-fill",
        "one-fill",
        "compact",
        "skip",
      ),
    })
    .map(
      ({ bottomLevel, startAt, gapStrategy }): NumberingSettings => ({
        ...DEFAULT_SETTINGS,
        topLevel: topLevel as HeadingLevel,
        bottomLevel: bottomLevel as HeadingLevel,
        startAt,
        gapStrategy,
      }),
    ),
);

function markdownFor(levels: readonly HeadingLevel[]): string {
  return `${levels
    .map((level, index) => `${"#".repeat(level)} Heading-${index}`)
    .join("\n")}\n`;
}

describe("numbering properties", () => {
  it("advances safely or throws at the safe integer boundary", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER),
        fc.integer({ min: 1, max: 3 }),
        (startAt, headingCount) => {
          const markdown = `${Array.from(
            { length: headingCount },
            (_, index) => `## Heading-${index}`,
          ).join("\n")}\n`;
          const build = () =>
            buildNumberingPlan(scanHeadings(markdown), {
              ...DEFAULT_SETTINGS,
              startAt,
            });
          const safeHeadingCount = Number.MAX_SAFE_INTEGER - startAt + 1;

          if (headingCount <= safeHeadingCount) {
            expect(build().entries.map((entry) => entry.displayPrefix)).toEqual(
              Array.from({ length: headingCount }, (_, index) =>
                String(startAt + index),
              ),
            );
          } else {
            expect(build).toThrowError(NumberingOverflowError);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("builds a completely deterministic plan", () => {
    fc.assert(
      fc.property(headingLevels, settings, (levels, numberingSettings) => {
        const headings = scanHeadings(markdownFor(levels));

        expect(buildNumberingPlan(headings, numberingSettings)).toEqual(
          buildNumberingPlan(headings, numberingSettings),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it("keeps bytes stable when the same plan is applied twice", () => {
    fc.assert(
      fc.property(headingLevels, settings, (levels, numberingSettings) => {
        const markdown = markdownFor(levels);
        const plan = buildNumberingPlan(
          scanHeadings(markdown),
          numberingSettings,
        );
        const once = applyPlan(markdown, plan);

        expect(applyPlan(once, plan)).toBe(once);
      }),
      { numRuns: 1000 },
    );
  });

  it("never duplicates a non-empty prefix inside a section", () => {
    fc.assert(
      fc.property(headingLevels, settings, (levels, numberingSettings) => {
        const plan = buildNumberingPlan(
          scanHeadings(markdownFor(levels)),
          numberingSettings,
        );
        let seen = new Set<string>();

        for (const entry of plan.entries) {
          if (entry.heading.level < numberingSettings.topLevel) {
            seen = new Set<string>();
          }
          if (entry.displayPrefix.length === 0) {
            continue;
          }
          expect(seen.has(entry.displayPrefix)).toBe(false);
          seen.add(entry.displayPrefix);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("numbers semantic titles and canonicalizes stale managed prefixes", () => {
    const titleCase = fc.oneof(
      fc
        .constantFrom(
          "2024. Roadmap",
          "2024-08-25 release",
          "192.168.1.1 gateway",
          "v1.2.3 release",
          "8080 service",
          "3.14 radians",
        )
        .map((title) => ({
          title,
          ownership: "semantic" as const,
          expected: `## 1. ${title}\n`,
        })),
      fc
        .constantFrom("9. Old candidate", "7.2. Candidate", "42. Candidate")
        .map((title) => ({
          title,
          ownership: "managed-stale" as const,
          expected: `## 1. ${title.slice(title.indexOf(". ") + 2)}\n`,
        })),
    );

    fc.assert(
      fc.property(titleCase, ({ title, ownership, expected }) => {
        const markdown = `## ${title}\n`;
        const plan = buildNumberingPlan(
          scanHeadings(markdown),
          DEFAULT_SETTINGS,
        );

        expect(plan.entries[0]?.ownership).toBe(ownership);
        expect(applyPlan(markdown, plan)).toBe(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it("preserves numeric text that does not use the configured title separator", () => {
    const markdown = "## 42 Candidate\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);

    expect(plan.entries[0]).toMatchObject({
      ownership: "ambiguous",
      action: "preserve",
    });
    expect(applyPlan(markdown, plan)).toBe(markdown);
  });
});

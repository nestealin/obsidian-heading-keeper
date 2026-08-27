import { describe, expect, it } from "vitest";
import {
  applyPlan,
  buildNumberingPlan,
  DEFAULT_SETTINGS,
  NumberingOverflowError,
  scanHeadings,
  StalePlanError,
} from "../src/index.js";

describe("buildNumberingPlan", () => {
  const headings = scanHeadings("## Root\n#### Child\n");

  it.each([
    ["zero-fill", ["1", "1.0.1"]],
    ["one-fill", ["1", "1.1.1"]],
    ["compact", ["1", "1.1"]],
    ["skip", ["1", ""]],
  ] as const)("implements %s gaps", (gapStrategy, expected) => {
    const plan = buildNumberingPlan(headings, {
      ...DEFAULT_SETTINGS,
      gapStrategy,
    });

    expect(plan.entries.map((entry) => entry.displayPrefix)).toEqual(expected);
  });

  it("re-expands compact numbering when an intermediate level appears", () => {
    const before = buildNumberingPlan(
      scanHeadings("## Root\n#### Child\n"),
      DEFAULT_SETTINGS,
    );
    const after = buildNumberingPlan(
      scanHeadings("## Root\n### Mid\n#### Child\n"),
      DEFAULT_SETTINGS,
    );

    expect(before.entries[1]?.displayPrefix).toBe("1.1");
    expect(after.entries[2]?.displayPrefix).toBe("1.1.1");
  });

  it("increments visible levels and resets deeper physical counters", () => {
    const plan = buildNumberingPlan(
      scanHeadings(
        [
          "## Root",
          "### First",
          "### Second",
          "#### Child",
          "## Next",
          "#### Gap",
        ].join("\n"),
      ),
      { ...DEFAULT_SETTINGS, startAt: 3, gapStrategy: "zero-fill" },
    );

    expect(plan.entries.map((entry) => entry.displayPrefix)).toEqual([
      "3",
      "3.1",
      "3.2",
      "3.2.1",
      "4",
      "4.0.1",
    ]);
  });

  it("treats headings above topLevel as section boundaries", () => {
    const plan = buildNumberingPlan(
      scanHeadings("## First\n# Boundary\n## Restart\n"),
      { ...DEFAULT_SETTINGS, startAt: 4 },
    );

    expect(plan.entries.map((entry) => entry.displayPrefix)).toEqual([
      "4",
      "",
      "4",
    ]);
  });

  it("does not let headings below bottomLevel pollute visible counters", () => {
    const plan = buildNumberingPlan(
      scanHeadings("## Root\n#### Ignored\n### Child\n"),
      { ...DEFAULT_SETTINGS, bottomLevel: 3, gapStrategy: "zero-fill" },
    );

    expect(plan.entries.map((entry) => entry.displayPrefix)).toEqual([
      "1",
      "",
      "1.1",
    ]);
  });

  it("matches the accepted Number Headings H3-H5 Arabic-dot profile", () => {
    const markdown = [
      "## Unnumbered section",
      "### First",
      "#### Child",
      "##### Grandchild",
      "###### Below configured range",
      "### Second",
      "## Next section",
      "### Restart",
      "",
    ].join("\n");
    const plan = buildNumberingPlan(scanHeadings(markdown), {
      ...DEFAULT_SETTINGS,
      topLevel: 3,
      bottomLevel: 5,
      startAt: 1,
      numberSeparator: ".",
      titleSeparator: ". ",
      gapStrategy: "compact",
    });

    expect(applyPlan(markdown, plan)).toBe(
      [
        "## Unnumbered section",
        "### 1. First",
        "#### 1.1. Child",
        "##### 1.1.1. Grandchild",
        "###### Below configured range",
        "### 2. Second",
        "## Next section",
        "### 1. Restart",
        "",
      ].join("\n"),
    );
  });

  it("skip resumes after a valid parent and emits a stable diagnostic", () => {
    const headings = scanHeadings(
      "## Root\n#### Missing parent\n### Parent\n#### Recovered\n",
    );
    const settings = { ...DEFAULT_SETTINGS, gapStrategy: "skip" as const };
    const first = buildNumberingPlan(headings, settings);
    const second = buildNumberingPlan(headings, settings);

    expect(first.entries.map((entry) => entry.displayPrefix)).toEqual([
      "1",
      "",
      "1.1",
      "1.1.1",
    ]);
    expect(first.diagnostics).toEqual([
      {
        code: "missing-parent",
        message: "Heading was preserved because a parent level is missing.",
        line: 1,
        sourceRange: { from: 8, to: 27 },
      },
    ]);
    expect(second).toEqual(first);
  });

  it("treats a top-level startAt of zero as an existing skip parent", () => {
    const plan = buildNumberingPlan(scanHeadings("## Root\n### Child\n"), {
      ...DEFAULT_SETTINGS,
      startAt: 0,
      gapStrategy: "skip",
    });

    expect(plan.entries.map((entry) => entry.displayPrefix)).toEqual([
      "0",
      "0.1",
    ]);
    expect(plan.diagnostics).toEqual([]);
  });

  it("rejects an unsafe initial counter before building a prefix", () => {
    expect(() =>
      buildNumberingPlan(scanHeadings("## Root\n"), {
        ...DEFAULT_SETTINGS,
        startAt: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrowError(NumberingOverflowError);
  });

  it("throws a stable overflow error when a counter cannot advance", () => {
    try {
      buildNumberingPlan(scanHeadings("## First\n## Second\n"), {
        ...DEFAULT_SETTINGS,
        startAt: Number.MAX_SAFE_INTEGER,
      });
      throw new Error("Expected numbering to reject counter overflow.");
    } catch (error) {
      expect(error).toBeInstanceOf(NumberingOverflowError);
      expect(error).toMatchObject({
        code: "counter-overflow",
        level: 2,
      });
    }
  });

  it("uses ownership to choose canonical plan actions", () => {
    const plan = buildNumberingPlan(
      scanHeadings(
        [
          "## 1. Existing",
          "## Overview",
          "## 2024. Roadmap",
          "## 9. Old candidate",
        ].join("\n"),
      ),
      DEFAULT_SETTINGS,
    );

    expect(
      plan.entries.map(({ displayPrefix, ownership, action }) => ({
        displayPrefix,
        ownership,
        action,
      })),
    ).toEqual([
      { displayPrefix: "1", ownership: "exact", action: "preserve" },
      { displayPrefix: "2", ownership: "absent", action: "insert" },
      { displayPrefix: "3", ownership: "semantic", action: "insert" },
      {
        displayPrefix: "4",
        ownership: "managed-stale",
        action: "replace",
      },
    ]);
  });

  it("replaces stale managed prefixes and numbers semantic titles without losing text", () => {
    const markdown = [
      "## 9. Old title",
      "## 2024. Roadmap",
      "## Overview",
      "",
    ].join("\n");
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);

    expect(
      plan.entries.map(({ displayPrefix, ownership, action }) => ({
        displayPrefix,
        ownership,
        action,
      })),
    ).toEqual([
      { displayPrefix: "1", ownership: "managed-stale", action: "replace" },
      { displayPrefix: "2", ownership: "semantic", action: "insert" },
      { displayPrefix: "3", ownership: "absent", action: "insert" },
    ]);
    expect(applyPlan(markdown, plan)).toBe(
      ["## 1. Old title", "## 2. 2024. Roadmap", "## 3. Overview", ""].join(
        "\n",
      ),
    );
  });

  it("captures and uses custom numbering format for ownership", () => {
    const format = { numberSeparator: "-", titleSeparator: ":" };
    const plan = buildNumberingPlan(
      scanHeadings("## 1:Root\n### 1-1:Child\n### 9-9:Old\n"),
      { ...DEFAULT_SETTINGS, ...format },
    );

    expect(plan.format).toEqual(format);
    expect(
      plan.entries.map(({ ownership, action }) => ({ ownership, action })),
    ).toEqual([
      { ownership: "exact", action: "preserve" },
      { ownership: "exact", action: "preserve" },
      { ownership: "managed-stale", action: "replace" },
    ]);
  });

  it("classifies ownership even when the heading action is skip", () => {
    const markdown = "# 2024. Roadmap\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);

    expect(plan.entries[0]).toMatchObject({
      displayPrefix: "",
      ownership: "semantic",
      action: "skip",
    });
    expect(applyPlan(markdown, plan)).toBe(markdown);
  });
});

describe("applyPlan", () => {
  function expectStaleCode(run: () => unknown, code: string): void {
    try {
      run();
      throw new Error("Expected applyPlan to reject the plan.");
    } catch (error) {
      expect(error).toBeInstanceOf(StalePlanError);
      expect(error).toMatchObject({ code });
    }
  }

  it("inserts only absent prefixes and is idempotent with the same plan", () => {
    const markdown = [
      "## Overview",
      "## 2. Existing",
      "## 2024. Roadmap",
      "## 9. Old candidate",
      "",
    ].join("\n");
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);

    const applied = applyPlan(markdown, plan);

    expect(applied).toBe(
      [
        "## 1. Overview",
        "## 2. Existing",
        "## 3. 2024. Roadmap",
        "## 4. Old candidate",
        "",
      ].join("\n"),
    );
    expect(applyPlan(applied, plan)).toBe(applied);
    expect(
      plan.entries.map(({ action, edit }) => ({
        action,
        hasEdit: edit !== undefined,
      })),
    ).toEqual([
      { action: "insert", hasEdit: true },
      { action: "preserve", hasEdit: false },
      { action: "insert", hasEdit: true },
      { action: "replace", hasEdit: true },
    ]);
  });

  it("uses the custom title separator captured by the plan", () => {
    const markdown = "## Overview\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), {
      ...DEFAULT_SETTINGS,
      titleSeparator: " — ",
    });

    expect(applyPlan(markdown, plan)).toBe("## 1 — Overview\n");
  });

  it("rejects stale heading text instead of silently skipping it", () => {
    const markdown = "## Overview\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);

    expectStaleCode(() => applyPlan("## Changed\n", plan), "stale-text");
  });

  it.each([
    ["preserve", "## 1. Existing\n", "## 1. Changed\n"],
    ["skip", "# Boundary\n", "# Changed\n"],
  ] as const)("validates stale text for a %s entry", (_, original, current) => {
    const plan = buildNumberingPlan(scanHeadings(original), DEFAULT_SETTINGS);

    expectStaleCode(() => applyPlan(current, plan), "stale-text");
  });

  it("rejects the whole plan before applying an insert when a preserve entry is stale", () => {
    const markdown = "## First\n## 2. Existing\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const stale = "## First\n## 2. Changed\n";

    expectStaleCode(() => applyPlan(stale, plan), "stale-text");
    expect(stale).toBe("## First\n## 2. Changed\n");
  });

  it("rejects duplicate line and level targets", () => {
    const markdown = "## First\n## Second\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const first = plan.entries[0];
    const second = plan.entries[1];
    if (!first || !second) {
      throw new Error("Expected two plan entries.");
    }
    second.heading.line = first.heading.line;

    expectStaleCode(() => applyPlan(markdown, plan), "duplicate-target");
  });

  it.each([
    [{ numberSeparator: "", titleSeparator: ". " }],
    [{ numberSeparator: ".\n", titleSeparator: ". " }],
    [{ numberSeparator: ".", titleSeparator: "" }],
    [{ numberSeparator: ".", titleSeparator: ".\r" }],
  ] as const)("rejects an invalid plan format snapshot", (format) => {
    const markdown = "## Overview\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);

    expectStaleCode(
      () => applyPlan(markdown, { ...plan, format }),
      "invalid-format",
    );
  });

  it.each([[-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]])(
    "rejects unsafe numbering segments %j",
    (segments) => {
      const markdown = "## Overview\n";
      const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
      const entry = plan.entries[0];
      if (!entry) {
        throw new Error("Expected a plan entry.");
      }
      entry.segments = segments;

      expectStaleCode(() => applyPlan(markdown, plan), "invalid-segments");
    },
  );

  it("rejects a display prefix not derived from segments and format", () => {
    const markdown = "## Overview\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const entry = plan.entries[0];
    if (!entry?.edit) {
      throw new Error("Expected an editable plan entry.");
    }
    entry.displayPrefix = "999";
    entry.edit.replacementText = "999. Overview";

    expectStaleCode(() => applyPlan(markdown, plan), "prefix-mismatch");
  });

  it("rejects non-empty numbering data on a skip entry", () => {
    const markdown = "# Boundary\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const entry = plan.entries[0];
    if (!entry) {
      throw new Error("Expected a plan entry.");
    }
    entry.segments = [1];
    entry.displayPrefix = "1";

    expectStaleCode(() => applyPlan(markdown, plan), "invalid-skip");
  });

  it("rejects forged semantic ownership for an absent title", () => {
    const markdown = "## Overview\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const entry = plan.entries[0];
    if (!entry) {
      throw new Error("Expected a plan entry.");
    }
    entry.ownership = "semantic";
    entry.action = "preserve";
    delete entry.edit;

    expectStaleCode(() => applyPlan(markdown, plan), "ownership-mismatch");
  });

  it("rejects every replace action even when ownership claims exact", () => {
    const markdown = "## 1. Existing\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const entry = plan.entries[0];
    if (!entry) {
      throw new Error("Expected a plan entry.");
    }
    entry.action = "replace";
    entry.edit = {
      range: entry.heading.contentRange,
      expectedText: entry.heading.rawText,
      replacementText: "1. Forged",
    };

    expectStaleCode(() => applyPlan(markdown, plan), "unsafe-edit");
  });

  it("requires the insert replacement to match the complete format exactly", () => {
    const markdown = "## Overview\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const edit = plan.entries[0]?.edit;
    if (!edit) {
      throw new Error("Expected an editable plan entry.");
    }
    edit.replacementText = "1 Overview";

    expectStaleCode(() => applyPlan(markdown, plan), "unsafe-edit");
  });

  it.each([
    ["missing-heading", "Introduction\n## Overview\n"],
    ["heading-mismatch", "### Overview\n"],
  ] as const)("rejects a %s at the planned line", (code, current) => {
    const markdown = "## Overview\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);

    expectStaleCode(() => applyPlan(current, plan), code);
  });

  it("rejects out-of-bounds source, content, and edit ranges", () => {
    const markdown = "## Overview\n";

    for (const rangeKind of ["source", "content", "edit"] as const) {
      const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
      const entry = plan.entries[0];
      if (!entry?.edit) {
        throw new Error("Expected an editable plan entry.");
      }
      if (rangeKind === "source") {
        entry.heading.sourceRange = { from: 0, to: markdown.length + 1 };
      } else if (rangeKind === "content") {
        entry.heading.contentRange = { from: 3, to: markdown.length + 1 };
      } else {
        entry.edit.range = { from: 3, to: markdown.length + 1 };
      }

      expectStaleCode(() => applyPlan(markdown, plan), "out-of-bounds");
    }
  });

  it("rejects overlapping edit ranges before applying any change", () => {
    const markdown = "## First\n## Second\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const first = plan.entries[0]?.edit;
    const second = plan.entries[1]?.edit;
    if (!first || !second) {
      throw new Error("Expected two editable plan entries.");
    }
    const firstEntry = plan.entries[0];
    const secondEntry = plan.entries[1];
    if (!firstEntry || !secondEntry) {
      throw new Error("Expected two plan entries.");
    }
    secondEntry.heading.sourceRange = { ...firstEntry.heading.sourceRange };
    secondEntry.heading.contentRange = { ...firstEntry.heading.contentRange };
    second.range = { ...first.range };

    expectStaleCode(() => applyPlan(markdown, plan), "overlapping-edit");
  });

  it("rejects unsafe action and edit combinations", () => {
    const markdown = "## Overview\n";
    const withEditOnPreserve = buildNumberingPlan(
      scanHeadings(markdown),
      DEFAULT_SETTINGS,
    );
    const preserveEntry = withEditOnPreserve.entries[0];
    if (!preserveEntry) {
      throw new Error("Expected a plan entry.");
    }
    preserveEntry.action = "preserve";
    expectStaleCode(
      () => applyPlan(markdown, withEditOnPreserve),
      "unsafe-edit",
    );

    const missingEdit = buildNumberingPlan(
      scanHeadings(markdown),
      DEFAULT_SETTINGS,
    );
    delete missingEdit.entries[0]?.edit;
    expectStaleCode(() => applyPlan(markdown, missingEdit), "missing-edit");
  });

  it("rejects an edit range that disagrees with the scanned content range", () => {
    const markdown = "## Overview\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const edit = plan.entries[0]?.edit;
    if (!edit) {
      throw new Error("Expected an editable plan entry.");
    }
    edit.range = { from: edit.range.from + 1, to: edit.range.to };

    expectStaleCode(() => applyPlan(markdown, plan), "range-mismatch");
  });

  it("rejects an insert edit that could overwrite the original title", () => {
    const markdown = "## Overview\n";
    const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
    const edit = plan.entries[0]?.edit;
    if (!edit) {
      throw new Error("Expected an editable plan entry.");
    }
    edit.replacementText = "Destroyed";

    expectStaleCode(() => applyPlan(markdown, plan), "unsafe-edit");
  });

  it.each(["semantic", "ambiguous"] as const)(
    "rejects a forged replace for %s ownership",
    (ownership) => {
      const title = ownership === "semantic" ? "2024. Roadmap" : "9. Old";
      const markdown = `## ${title}\n`;
      const plan = buildNumberingPlan(scanHeadings(markdown), DEFAULT_SETTINGS);
      const entry = plan.entries[0];
      if (!entry) {
        throw new Error("Expected a plan entry.");
      }
      entry.action = "replace";
      entry.edit = {
        range: entry.heading.contentRange,
        expectedText: entry.heading.rawText,
        replacementText: `1. ${entry.heading.rawText}`,
      };

      expectStaleCode(() => applyPlan(markdown, plan), "unsafe-edit");
    },
  );
});

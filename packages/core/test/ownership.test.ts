import { Worker } from "node:worker_threads";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  buildNumberingPlan,
  classifyOwnership,
  DEFAULT_SETTINGS,
  scanHeadings,
} from "../src/index.js";
import type { NumberingFormat, Ownership } from "../src/index.js";

interface WorkerCase {
  readonly title: string;
  readonly expectedPrefix: string;
  readonly format: Readonly<NumberingFormat>;
}

function classifyInWorker(
  cases: readonly WorkerCase[],
): Promise<readonly Ownership[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./ownership.worker.mjs", import.meta.url),
      {
        workerData: cases,
      },
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error("ownership classification exceeded 500 ms"));
    }, 500);

    worker.once("message", (results: readonly Ownership[]) => {
      clearTimeout(timeout);
      resolve(results);
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function heading(title: string) {
  const node = scanHeadings(`## ${title}\n`)[0];
  if (!node) {
    throw new Error("Expected heading fixture to scan.");
  }
  return node;
}

describe("classifyOwnership", () => {
  it("finishes for long repeated numeric separators with and without a title separator", async () => {
    const repeatedDigits = "1".repeat(48);
    const format = { numberSeparator: "1", titleSeparator: "x" };

    await expect(
      classifyInWorker([
        { title: `${repeatedDigits}y`, expectedPrefix: "2", format },
        { title: `${repeatedDigits}xTitle`, expectedPrefix: "2", format },
      ]),
    ).resolves.toEqual(["absent", "ambiguous"]);
  });

  it("recognizes only a complete visible prefix equal to the computed prefix", () => {
    expect(classifyOwnership(heading("1.2. Managed"), "1.2")).toBe("exact");
    expect(classifyOwnership(heading("1.2.3. Managed"), "1.2")).toBe(
      "ambiguous",
    );
    expect(classifyOwnership(heading("2.1. Managed"), "1.2")).toBe("ambiguous");
  });

  it("recognizes an exact prefix followed by a custom title separator", () => {
    expect(
      classifyOwnership(heading("1-2 — Managed"), "1-2", {
        numberSeparator: "-",
        titleSeparator: " — ",
      }),
    ).toBe("exact");
  });

  it("uses the actual title separator for exact ownership", () => {
    const format = { numberSeparator: ".", titleSeparator: ":" };

    expect(classifyOwnership(heading("1.2:Managed"), "1.2", format)).toBe(
      "exact",
    );
    expect(classifyOwnership(heading("1.2. Managed"), "1.2", format)).not.toBe(
      "exact",
    );
  });

  it("uses the actual number separator to identify a different candidate", () => {
    const format = { numberSeparator: "-", titleSeparator: ":" };

    expect(classifyOwnership(heading("1-2:Managed"), "1-2", format)).toBe(
      "exact",
    );
    expect(classifyOwnership(heading("9-8:Managed"), "1-2", format)).toBe(
      "ambiguous",
    );
  });

  it.each(["999.1.1.1", "1.2.3.4.5"])(
    "never treats the standard numeric chain %s as absent",
    (numericChain) => {
      expect(
        classifyOwnership(heading(`${numericChain} candidate`), "1"),
      ).not.toBe("absent");
    },
  );

  it("keeps strong semantic protection ahead of formatted exact matching", () => {
    const format = { numberSeparator: "-", titleSeparator: ":" };

    expect(
      classifyOwnership(heading("2024-08-25:release"), "2024-08-25", format),
    ).toBe("semantic");
  });

  it("returns absent when the title does not start with a numeric candidate", () => {
    expect(classifyOwnership(heading("Overview"), "1")).toBe("absent");
    expect(classifyOwnership(heading("3D Printing"), "1")).toBe("absent");
  });

  it("protects long numeric-leading titles containing generated numeric or punctuation separators", () => {
    const separator = fc
      .array(
        fc.constantFrom("0", "1", "9", ".", "-", "_", ":", "+", "*", "?"),
        {
          minLength: 1,
          maxLength: 12,
        },
      )
      .map((parts) => parts.join(""));
    const numericLead = fc
      .array(fc.constantFrom("0", "1", "2", "7", "9"), {
        minLength: 64,
        maxLength: 512,
      })
      .map((parts) => parts.join(""));

    fc.assert(
      fc.property(
        separator,
        separator,
        numericLead,
        fc.constantFrom("Title", "candidate", "y"),
        (numberSeparator, titleSeparator, digits, suffix) => {
          const title = `${digits}${titleSeparator}${suffix}`;
          const format = { numberSeparator, titleSeparator };
          const ownership = classifyOwnership(heading(title), "2", format);
          const plan = buildNumberingPlan(scanHeadings(`## ${title}\n`), {
            ...DEFAULT_SETTINGS,
            ...format,
          });
          const validOwnership = ["absent", "exact", "semantic", "ambiguous"];

          expect(validOwnership).toContain(ownership);
          expect(validOwnership).toContain(plan.entries[0]?.ownership);
          expect(ownership).not.toBe("absent");
          expect(plan.entries[0]?.ownership).not.toBe("absent");
        },
      ),
      { numRuns: 1000 },
    );
  });

  it.each([
    ["year", "2024. Roadmap", "2024"],
    ["date", "2024-08-25 release", "1"],
    ["IPv4", "192.168.1.1 gateway", "1.1"],
    ["version", "v1.2.3 release", "1.2.3"],
    ["port", "8080 service", "1"],
    ["decimal", "3.14 radians", "3.14"],
  ] as const)(
    "preserves a leading %s as semantic text",
    (_, title, expected) => {
      expect(classifyOwnership(heading(title), expected)).toBe("semantic");
    },
  );

  it("treats other leading numeric-dot candidates as ambiguous", () => {
    expect(classifyOwnership(heading("7.2. Candidate"), "1.1")).toBe(
      "ambiguous",
    );
    expect(classifyOwnership(heading("42. Candidate"), "1")).toBe("ambiguous");
  });
});

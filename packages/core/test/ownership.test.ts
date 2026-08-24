import { describe, expect, it } from "vitest";
import { classifyOwnership, scanHeadings } from "../src/index.js";

function heading(title: string) {
  const node = scanHeadings(`## ${title}\n`)[0];
  if (!node) {
    throw new Error("Expected heading fixture to scan.");
  }
  return node;
}

describe("classifyOwnership", () => {
  it("recognizes only a complete visible prefix equal to the computed prefix", () => {
    expect(classifyOwnership(heading("1.2. Managed"), "1.2")).toBe("exact");
    expect(classifyOwnership(heading("1.2.3. Managed"), "1.2")).toBe(
      "ambiguous",
    );
    expect(classifyOwnership(heading("2.1. Managed"), "1.2")).toBe("ambiguous");
  });

  it("recognizes an exact prefix followed by a custom title separator", () => {
    expect(classifyOwnership(heading("1-2 — Managed"), "1-2")).toBe("exact");
  });

  it("returns absent when the title does not start with a numeric candidate", () => {
    expect(classifyOwnership(heading("Overview"), "1")).toBe("absent");
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

import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Modal: class {
    contentEl = {};
    constructor(readonly app: unknown) {}
  },
}));

import { auditHeadingLinks } from "@heading-keeper/link-core";
import { HeadingLinkRepairModal } from "../src/heading-link-repair-modal.js";

describe("HeadingLinkRepairModal", () => {
  it("filters and navigates without writes, exports no note bodies, and confirms only explicit choices", () => {
    const sources = [
      { path: "Target.md", text: "## Existing\n## Correct" },
      { path: "Refs.md", text: "[[Target#Missing]]" },
    ];
    const result = auditHeadingLinks({
      sources,
      resolveTarget: () => ({ kind: "file", path: "Target.md" }),
    });
    const confirms: unknown[] = [];
    const navigations: unknown[] = [];
    const exports: string[] = [];
    const modal = new HeadingLinkRepairModal({} as never, result, "en", {
      confirm: (selections) => confirms.push(selections),
      navigate: (path, line) => navigations.push([path, line]),
      exported: (json) => exports.push(json),
      closed: vi.fn(),
    });
    const finding = result.findings[0]!;

    expect(modal.filteredFindings("refs")).toEqual([finding]);
    expect(modal.confirmSelected()).toBe(false);
    expect(confirms).toEqual([]);
    expect(modal.navigateTo(finding.id)).toBe(true);
    expect(navigations).toEqual([["Refs.md", 1]]);
    const json = modal.exportReport();
    expect(exports).toEqual([json]);
    expect(json).not.toContain("## Existing");
    expect(json).not.toContain("note body");

    expect(modal.select(finding.id, "Target.md", "Guessed")).toBe(false);
    expect(modal.confirmSelected()).toBe(false);
    expect(modal.select(finding.id, "Target.md", "Correct")).toBe(true);
    expect(modal.confirmSelected()).toBe(true);
    expect(confirms).toEqual([
      [
        {
          findingId: finding.id,
          targetPath: "Target.md",
          heading: "Correct",
        },
      ],
    ]);
  });
});

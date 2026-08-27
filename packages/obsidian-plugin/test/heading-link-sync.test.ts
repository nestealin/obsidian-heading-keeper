import { describe, expect, it } from "vitest";
import {
  buildAutomaticHeadingLinkSync,
  SavedHeadingLinkSync,
} from "../src/heading-link-sync.js";
import { applyCheckedEdits } from "../src/persistence/edits.js";

const operationDependencies = {
  createId: () => "sync-1",
  now: () => "2026-08-26T00:00:00.000Z",
  hashText: async (text: string) => `hash:${text}`,
};

describe("buildAutomaticHeadingLinkSync", () => {
  it("builds sorted exact-identity link-only changes for one safe rename", async () => {
    const result = await buildAutomaticHeadingLinkSync(
      {
        targetPath: "Target.md",
        beforeText: "## Old title\n",
        afterText: "## New title\nSee [[#Old title|self]].\n",
        sources: [
          {
            path: "z.md",
            text: "[[Target#Old title|alias]] and plain Old title",
          },
          {
            path: "Target.md",
            text: "## New title\nSee [[#Old title|self]].\n",
          },
          {
            path: "a.md",
            text: '[label](Target.md#Old%20title "keep")',
          },
        ],
        resolveTarget: (_sourcePath, linkPath) => ({
          kind: "file",
          path:
            linkPath === "" || linkPath === "Target.md"
              ? "Target.md"
              : `${linkPath}.md`,
        }),
      },
      operationDependencies,
    );

    expect(result.kind).toBe("operation");
    if (result.kind !== "operation") return;
    expect(result.rename).toEqual({
      targetPath: "Target.md",
      oldHeading: "Old title",
      newHeading: "New title",
    });
    expect(result.operation.files.map((file) => file.path)).toEqual([
      "Target.md",
      "a.md",
      "z.md",
    ]);
    const beforeByPath = new Map([
      ["Target.md", "## New title\nSee [[#Old title|self]].\n"],
      ["a.md", '[label](Target.md#Old%20title "keep")'],
      ["z.md", "[[Target#Old title|alias]] and plain Old title"],
    ]);
    expect(
      result.operation.files.map((file) =>
        applyCheckedEdits(beforeByPath.get(file.path)!, file.edits),
      ),
    ).toEqual([
      "## New title\nSee [[#New title|self]].\n",
      '[label](Target.md#New%20title "keep")',
      "[[Target#New title|alias]] and plain Old title",
    ]);
    expect(
      result.operation.files.every((file) => file.role === "link-source"),
    ).toBe(true);
  });

  it("returns the conservative detector reason and performs no planning for compound changes", async () => {
    let resolverCalls = 0;
    const result = await buildAutomaticHeadingLinkSync(
      {
        targetPath: "Target.md",
        beforeText: "## A\n## B\n",
        afterText: "## C\n## D\n",
        sources: [{ path: "Refs.md", text: "[[Target#A]]" }],
        resolveTarget: () => {
          resolverCalls += 1;
          return { kind: "file", path: "Target.md" };
        },
      },
      operationDependencies,
    );

    expect(result).toEqual({
      kind: "unsafe",
      reason: "multiple-heading-changes",
    });
    expect(resolverCalls).toBe(0);
  });

  it("returns no-op when no current source links the old identity", async () => {
    await expect(
      buildAutomaticHeadingLinkSync(
        {
          targetPath: "Target.md",
          beforeText: "## Old\n",
          afterText: "## New\n",
          sources: [{ path: "Refs.md", text: "[[Other#Old]]" }],
          resolveTarget: () => ({ kind: "file", path: "Other.md" }),
        },
        operationDependencies,
      ),
    ).resolves.toEqual({
      kind: "no-op",
      rename: {
        targetPath: "Target.md",
        oldHeading: "Old",
        newHeading: "New",
      },
      diagnostics: [],
    });
  });
});

describe("SavedHeadingLinkSync", () => {
  it("indexes saved snapshots and serializes a direct rename through execution", async () => {
    const content = new Map([
      ["Target.md", "## Old\n"],
      ["Refs.md", "[[Target#Old]]"],
    ]);
    const executed: string[][] = [];
    const controller = new SavedHeadingLinkSync({
      enabled: () => true,
      listMarkdownPaths: () => ["Target.md", "Refs.md"],
      read: async (path) => content.get(path) ?? "",
      resolveTarget: () => ({ kind: "file", path: "Target.md" }),
      operationDependencies,
      execute: async (operation) => {
        executed.push(operation.files.map((file) => file.path));
        for (const file of operation.files) {
          content.set(
            file.path,
            applyCheckedEdits(content.get(file.path)!, file.edits),
          );
        }
        return {
          kind: "completed",
          operation: {
            ...operation,
            state: "completed",
            completedPaths: operation.files.map((file) => file.path),
          },
        };
      },
    });

    await controller.initialize();
    content.set("Target.md", "## New\n");
    const result = await controller.handleModify("Target.md");

    expect(result.kind).toBe("completed");
    expect(executed).toEqual([["Refs.md"]]);
    expect(content.get("Refs.md")).toBe("[[Target#New]]");
    expect(controller.snapshot("Target.md")).toBe("## New\n");
    expect(controller.snapshot("Refs.md")).toBeUndefined();
  });

  it("updates snapshots but never scans sources while disabled", async () => {
    const content = new Map([["Target.md", "## Old\n"]]);
    let lists = 0;
    const controller = new SavedHeadingLinkSync({
      enabled: () => false,
      listMarkdownPaths: () => {
        lists += 1;
        return ["Target.md"];
      },
      read: async (path) => content.get(path) ?? "",
      resolveTarget: () => ({ kind: "file", path: "Target.md" }),
      operationDependencies,
      execute: async () => ({ kind: "busy" }),
    });
    await controller.initialize();
    lists = 0;
    content.set("Target.md", "## New\n");

    await expect(controller.handleModify("Target.md")).resolves.toEqual({
      kind: "disabled",
    });
    expect(lists).toBe(0);
    expect(controller.snapshot("Target.md")).toBe("## New\n");
  });

  it("does not rescan the Vault for a body-only saved modification", async () => {
    const content = new Map([["Target.md", "## Stable\nold body\n"]]);
    let lists = 0;
    const controller = new SavedHeadingLinkSync({
      enabled: () => true,
      listMarkdownPaths: () => {
        lists += 1;
        return ["Target.md"];
      },
      read: async (path) => content.get(path) ?? "",
      resolveTarget: () => ({ kind: "file", path: "Target.md" }),
      operationDependencies,
      execute: async () => ({ kind: "busy" }),
    });
    await controller.initialize();
    lists = 0;
    content.set("Target.md", "## Stable\nnew body\n");

    await expect(controller.handleModify("Target.md")).resolves.toEqual({
      kind: "unsafe",
      reason: "unchanged-headings",
    });
    expect(lists).toBe(0);
  });

  it("does not infer a rename for a new file and invalidates queued work on dispose", async () => {
    const content = new Map([["New.md", "## New\n"]]);
    const controller = new SavedHeadingLinkSync({
      enabled: () => true,
      listMarkdownPaths: () => [],
      read: async (path) => content.get(path) ?? "",
      resolveTarget: () => ({ kind: "missing" }),
      operationDependencies,
      execute: async () => {
        throw new Error("must not execute");
      },
    });
    await controller.initialize();

    await expect(controller.handleModify("New.md")).resolves.toEqual({
      kind: "first-snapshot",
    });
    controller.dispose();
    content.set("New.md", "## Later\n");
    await expect(controller.handleModify("New.md")).resolves.toEqual({
      kind: "disposed",
    });
  });

  it("moves and deletes snapshot identities without interpreting a rename", async () => {
    const content = new Map([["Old.md", "## A\n"]]);
    const controller = new SavedHeadingLinkSync({
      enabled: () => true,
      listMarkdownPaths: () => ["Old.md"],
      read: async (path) => content.get(path) ?? "",
      resolveTarget: () => ({ kind: "missing" }),
      operationDependencies,
      execute: async () => ({ kind: "busy" }),
    });
    await controller.initialize();

    controller.handleRename("Old.md", "New.md");
    expect(controller.snapshot("Old.md")).toBeUndefined();
    expect(controller.snapshot("New.md")).toBe("## A\n");
    controller.handleDelete("New.md");
    expect(controller.snapshot("New.md")).toBeUndefined();
  });
});

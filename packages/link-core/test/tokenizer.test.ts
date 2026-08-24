import { describe, expect, it } from "vitest";
import { scanHeadingLinks } from "../src/index.js";

describe("scanHeadingLinks", () => {
  it("finds supported heading links outside protected syntax", () => {
    const markdown = [
      "[[Target#Old heading]]",
      "![[Target#Old%20heading|label]]",
      "[label](../Target.md#Old%20heading)",
      "`[[Target#Old heading]]`",
      "```md",
      "[[Target#Old heading]]",
      "```",
    ].join("\n");

    expect(scanHeadingLinks(markdown)).toHaveLength(3);
  });

  it("preserves syntax fields and UTF-16 source ranges for Wiki links", () => {
    const markdown = "🐙 [[#Old heading]] ![[Folder/Target#旧标题|原样 alias]]";

    expect(scanHeadingLinks(markdown)).toEqual([
      {
        kind: "wiki",
        range: { from: 3, to: 19 },
        raw: "[[#Old heading]]",
        linkPath: "",
        rawFragment: "Old heading",
        fragmentRange: { from: 6, to: 17 },
        alias: null,
        label: null,
        title: null,
        rawDestination: null,
        angleDestination: false,
      },
      {
        kind: "embed",
        range: { from: 20, to: 51 },
        raw: "![[Folder/Target#旧标题|原样 alias]]",
        linkPath: "Folder/Target",
        rawFragment: "旧标题",
        fragmentRange: { from: 37, to: 40 },
        alias: "原样 alias",
        label: null,
        title: null,
        rawDestination: null,
        angleDestination: false,
      },
    ]);
  });

  it("preserves Markdown labels, image alt text, angle style, and titles", () => {
    const markdown = [
      '[label](<../Target file.md?view=1#Old heading> "keep title")',
      "![原样 alt](images/Target.md#旧%20标题 '原样 title')",
    ].join("\n");

    expect(scanHeadingLinks(markdown)).toEqual([
      {
        kind: "markdown",
        range: { from: 0, to: 60 },
        raw: '[label](<../Target file.md?view=1#Old heading> "keep title")',
        linkPath: "../Target file.md",
        rawFragment: "Old heading",
        fragmentRange: { from: 34, to: 45 },
        alias: null,
        label: "label",
        title: '"keep title"',
        rawDestination: "../Target file.md?view=1#Old heading",
        angleDestination: true,
      },
      {
        kind: "image",
        range: { from: 61, to: 106 },
        raw: "![原样 alt](images/Target.md#旧%20标题 '原样 title')",
        linkPath: "images/Target.md",
        rawFragment: "旧%20标题",
        fragmentRange: { from: 88, to: 94 },
        alias: null,
        label: "原样 alt",
        title: "'原样 title'",
        rawDestination: "images/Target.md#旧%20标题",
        angleDestination: false,
      },
    ]);
  });

  it("protects YAML, tilde fences, and matching inline backtick runs", () => {
    const markdown = [
      "---",
      "link: [[Hidden#Heading]]",
      "---",
      "~~~-md",
      "[[Hidden#Heading]]",
      "~~~",
      "``code ` [[Hidden#Heading]] ``",
      "[[Visible#Heading]]",
    ].join("\n");

    expect(scanHeadingLinks(markdown).map((token) => token.raw)).toEqual([
      "[[Visible#Heading]]",
    ]);
  });

  it("protects an unclosed YAML frontmatter region through end of input", () => {
    const markdown = ["---", "link: [[Hidden#Heading]]"].join("\n");

    expect(scanHeadingLinks(markdown)).toEqual([]);
  });

  it.each([
    ["closed CRLF frontmatter", "---\r\nlink: [[Hidden#Heading]]\r\n---\r\n"],
    ["unclosed CRLF frontmatter", "---\r\nlink: [[Hidden#Heading]]\r\n"],
    ["CRLF backtick fence", "```md\r\n[[Hidden#Heading]]\r\n```\r\n"],
    ["CRLF tilde fence", "~~~md\r\n[[Hidden#Heading]]\r\n~~~\r\n"],
  ])("protects heading links inside %s", (_name, markdown) => {
    expect(scanHeadingLinks(markdown)).toEqual([]);
  });

  it.each([
    ["Wiki opener", "[[Broken#Old\r\n[[Target#Old]]", "[[Target#Old]]"],
    [
      "Markdown label opener",
      "[broken\r\n[label](Target.md#Old)",
      "[label](Target.md#Old)",
    ],
  ])(
    "does not close an unclosed %s from a later line",
    (_name, markdown, raw) => {
      expect(scanHeadingLinks(markdown).map((token) => token.raw)).toEqual([
        raw,
      ]);
    },
  );

  it("keeps pure-file and block-reference candidates available to the planner", () => {
    const markdown = "[[Target]] [[Target#^block]] [file](Target.md)";

    expect(
      scanHeadingLinks(markdown).map(({ raw, rawFragment }) => ({
        raw,
        rawFragment,
      })),
    ).toEqual([
      { raw: "[[Target]]", rawFragment: null },
      { raw: "[[Target#^block]]", rawFragment: "^block" },
      { raw: "[file](Target.md)", rawFragment: null },
    ]);
  });
});

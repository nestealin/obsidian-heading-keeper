import type { SourceRange } from "@heading-numbering/core";
import type { LinkToken } from "./types.js";

interface LogicalLine {
  from: number;
  to: number;
  text: string;
}

function scanLogicalLines(markdown: string): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let from = 0;

  while (from < markdown.length) {
    const newline = markdown.indexOf("\n", from);
    const to = newline < 0 ? markdown.length : newline + 1;
    const contentTo =
      newline > from && markdown[newline - 1] === "\r" ? newline - 1 : newline;
    lines.push({
      from,
      to,
      text: markdown.slice(from, newline < 0 ? markdown.length : contentTo),
    });
    from = to;
  }

  return lines;
}

function protectedRanges(markdown: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const lines = scanLogicalLines(markdown);

  if (lines[0]?.text === "---") {
    let frontmatterClosed = false;
    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line) continue;
      if (/^(?:---|\.\.\.)[ \t]*$/.test(line.text)) {
        ranges.push({ from: 0, to: line.to });
        frontmatterClosed = true;
        break;
      }
    }
    if (!frontmatterClosed) ranges.push({ from: 0, to: markdown.length });
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const opener = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (!opener) continue;
    const run = opener[2];
    const info = opener[3] ?? "";
    if (!run || (run[0] === "`" && info.includes("`"))) continue;
    const from = line.from;
    let to = markdown.length;
    for (
      let closeIndex = lineIndex + 1;
      closeIndex < lines.length;
      closeIndex += 1
    ) {
      const closing = lines[closeIndex];
      if (!closing) continue;
      const closingRun = /^( {0,3})(`+|~+)[ \t]*$/.exec(closing.text)?.[2];
      if (
        closingRun !== undefined &&
        closingRun[0] === run[0] &&
        closingRun.length >= run.length
      ) {
        to = closing.to;
        lineIndex = closeIndex;
        break;
      }
    }
    ranges.push({ from, to });
  }

  for (const line of lines) {
    const lineFrom = line.from;
    const lineTo = lineFrom + line.text.length;
    let cursor = lineFrom;
    while (cursor < lineTo) {
      if (markdown[cursor] !== "`" || isProtected(cursor, ranges)) {
        cursor += 1;
        continue;
      }
      let openerTo = cursor;
      while (markdown[openerTo] === "`") openerTo += 1;
      const run = markdown.slice(cursor, openerTo);
      let close = markdown.indexOf(run, openerTo);
      while (
        close >= 0 &&
        close < lineTo &&
        (markdown[close - 1] === "`" || markdown[close + run.length] === "`")
      ) {
        close = markdown.indexOf(run, close + run.length);
      }
      const to = close >= 0 && close < lineTo ? close + run.length : lineTo;
      ranges.push({ from: cursor, to });
      cursor = to;
    }
  }
  return ranges;
}

function isProtected(index: number, ranges: readonly SourceRange[]): boolean {
  return ranges.some((range) => index >= range.from && index < range.to);
}

function logicalLineEnd(markdown: string, from: number): number {
  for (let index = from; index < markdown.length; index += 1) {
    if (markdown[index] === "\r" || markdown[index] === "\n") return index;
  }
  return markdown.length;
}

function wikiToken(markdown: string, from: number): LinkToken | null {
  const embedded = markdown.startsWith("![[", from);
  const startLength = embedded ? 3 : 2;
  if (!embedded && !markdown.startsWith("[[", from)) return null;
  const lineEnd = logicalLineEnd(markdown, from);
  const close = markdown.indexOf("]]", from + startLength);
  if (close < 0 || close + 2 > lineEnd) return null;
  const to = close + 2;
  const contentFrom = from + startLength;
  const content = markdown.slice(contentFrom, close);
  const aliasIndex = content.indexOf("|");
  const destination = aliasIndex < 0 ? content : content.slice(0, aliasIndex);
  const hashIndex = destination.indexOf("#");
  const fragmentFrom = hashIndex < 0 ? null : contentFrom + hashIndex + 1;

  return {
    kind: embedded ? "embed" : "wiki",
    range: { from, to },
    raw: markdown.slice(from, to),
    linkPath: hashIndex < 0 ? destination : destination.slice(0, hashIndex),
    rawFragment: hashIndex < 0 ? null : destination.slice(hashIndex + 1),
    fragmentRange:
      fragmentFrom === null
        ? null
        : { from: fragmentFrom, to: contentFrom + destination.length },
    alias: aliasIndex < 0 ? null : content.slice(aliasIndex + 1),
    label: null,
    title: null,
    rawDestination: null,
    angleDestination: false,
  };
}

function markdownToken(markdown: string, from: number): LinkToken | null {
  const image = markdown.startsWith("![", from);
  const labelFrom = from + (image ? 2 : 1);
  if (!image && markdown[from] !== "[") return null;
  const lineEnd = logicalLineEnd(markdown, from);
  const labelTo = markdown.indexOf("](", labelFrom);
  if (labelTo < 0 || labelTo + 2 > lineEnd) return null;
  const openParen = labelTo + 1;
  let cursor = openParen + 1;
  let angleDestination = false;
  let destinationFrom = cursor;
  let destinationTo = cursor;

  if (markdown[cursor] === "<") {
    angleDestination = true;
    destinationFrom = cursor + 1;
    destinationTo = markdown.indexOf(">", destinationFrom);
    if (destinationTo < 0 || destinationTo >= lineEnd) return null;
    cursor = destinationTo + 1;
  } else {
    let depth = 0;
    while (cursor < lineEnd) {
      const character = markdown[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
      } else if (/\s/.test(character ?? "")) {
        break;
      }
      cursor += 1;
    }
    destinationTo = cursor;
  }

  const rawDestination = markdown.slice(destinationFrom, destinationTo);
  while (markdown[cursor] === " " || markdown[cursor] === "\t") cursor += 1;
  let title: string | null = null;
  const titleStart = markdown[cursor];
  if (titleStart === '"' || titleStart === "'" || titleStart === "(") {
    const titleClose = titleStart === "(" ? ")" : titleStart;
    let titleTo = cursor + 1;
    while (titleTo < lineEnd) {
      if (markdown[titleTo] === "\\") {
        titleTo += 2;
        continue;
      }
      if (markdown[titleTo] === titleClose) break;
      titleTo += 1;
    }
    if (markdown[titleTo] !== titleClose) return null;
    title = markdown.slice(cursor, titleTo + 1);
    cursor = titleTo + 1;
    while (markdown[cursor] === " " || markdown[cursor] === "\t") cursor += 1;
  }
  if (markdown[cursor] !== ")") return null;
  const close = cursor;
  const hashIndex = rawDestination.indexOf("#");
  const fragmentFrom = hashIndex < 0 ? null : destinationFrom + hashIndex + 1;
  const to = close + 1;

  return {
    kind: image ? "image" : "markdown",
    range: { from, to },
    raw: markdown.slice(from, to),
    linkPath:
      (hashIndex < 0
        ? rawDestination
        : rawDestination.slice(0, hashIndex)
      ).split("?", 1)[0] ?? "",
    rawFragment: hashIndex < 0 ? null : rawDestination.slice(hashIndex + 1),
    fragmentRange:
      fragmentFrom === null
        ? null
        : { from: fragmentFrom, to: destinationFrom + rawDestination.length },
    alias: null,
    label: markdown.slice(labelFrom, labelTo),
    title,
    rawDestination,
    angleDestination,
  };
}

export function scanHeadingLinks(markdown: string): LinkToken[] {
  const tokens: LinkToken[] = [];
  const protectedSyntax = protectedRanges(markdown);

  for (let index = 0; index < markdown.length; index += 1) {
    if (isProtected(index, protectedSyntax)) continue;
    const token = wikiToken(markdown, index) ?? markdownToken(markdown, index);
    if (!token) continue;
    tokens.push(token);
    index = token.range.to - 1;
  }
  return tokens;
}

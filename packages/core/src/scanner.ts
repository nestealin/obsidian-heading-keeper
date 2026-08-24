import type { HeadingLevel, HeadingNode } from "./types.js";

export function scanHeadings(markdown: string): HeadingNode[] {
  const lines =
    markdown
      .match(/[^\r\n]*(?:\r\n|\n|$)/gu)
      ?.filter((item) => item.length > 0) ?? [];
  const headings: HeadingNode[] = [];
  let offset = 0;
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let inFrontmatter = lines[0]?.replace(/\r?\n$/u, "") === "---";

  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line] ?? "";
    const lineEnding = raw.endsWith("\r\n")
      ? "\r\n"
      : raw.endsWith("\n")
        ? "\n"
        : "";
    const content = raw.slice(0, raw.length - lineEnding.length);

    if (inFrontmatter) {
      if (line > 0 && content === "---") {
        inFrontmatter = false;
      }
      offset += raw.length;
      continue;
    }

    const fenceMatch = /^( {0,3})(`{3,}|~{3,})(.*)$/u.exec(content);
    if (fence) {
      const close = new RegExp(
        `^ {0,3}${fence.marker}{${fence.length},}[ \\t]*$`,
        "u",
      );
      if (close.test(content)) {
        fence = undefined;
      }
      offset += raw.length;
      continue;
    }
    if (fenceMatch) {
      const token = fenceMatch[2] ?? "";
      const info = fenceMatch[3] ?? "";
      if (token[0] !== "`" || !info.includes("`")) {
        fence = { marker: token[0] as "`" | "~", length: token.length };
      }
      offset += raw.length;
      continue;
    }

    const atx = /^( {0,3})(#{1,6})([ \t]+|$)(.*)$/u.exec(content);
    if (atx) {
      const indent = atx[1] ?? "";
      const marker = atx[2] ?? "";
      const spacing = atx[3] ?? "";
      const remainder = atx[4] ?? "";
      const closing = /^(.*?)([ \t]+#+[ \t]*)?$/u.exec(remainder);
      const rawText = closing?.[1] ?? remainder;
      const closingSequence = closing?.[2] ?? "";
      const contentFrom =
        offset + indent.length + marker.length + spacing.length;

      headings.push({
        level: marker.length as HeadingLevel,
        line,
        indent,
        marker,
        rawText,
        semanticText: rawText.trim(),
        sourceRange: { from: offset, to: offset + content.length },
        contentRange: { from: contentFrom, to: contentFrom + rawText.length },
        closingSequence,
        lineEnding,
      });
    }
    offset += raw.length;
  }

  return headings;
}

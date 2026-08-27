import type {
  HeadingNode,
  NumberingFormat,
  Ownership,
  SourceRange,
} from "./types.js";

const DEFAULT_FORMAT: Readonly<NumberingFormat> = Object.freeze({
  numberSeparator: ".",
  titleSeparator: ". ",
});

function hasSemanticBoundary(
  text: string,
  candidate: string,
  titleSeparator: string,
): boolean {
  const remainder = text.slice(candidate.length);
  return (
    remainder.length === 0 ||
    /^\s/u.test(remainder) ||
    remainder.startsWith(titleSeparator)
  );
}

function isIpv4Prefix(text: string, titleSeparator: string): boolean {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})/u.exec(text);
  if (!match?.[1]) {
    return false;
  }
  return (
    match[1].split(".").every((part) => Number(part) <= 255) &&
    hasSemanticBoundary(text, match[1], titleSeparator)
  );
}

function capturedSemanticForm(
  text: string,
  pattern: RegExp,
  titleSeparator: string,
): boolean {
  const candidate = pattern.exec(text)?.[1];
  return candidate
    ? hasSemanticBoundary(text, candidate, titleSeparator)
    : false;
}

function isSemanticNumericForm(text: string, titleSeparator: string): boolean {
  if (
    capturedSemanticForm(
      text,
      /^(v\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)/iu,
      titleSeparator,
    )
  ) {
    return true;
  }
  if (
    capturedSemanticForm(
      text,
      /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/u,
      titleSeparator,
    )
  ) {
    return true;
  }
  if (isIpv4Prefix(text, titleSeparator)) {
    return true;
  }
  if (capturedSemanticForm(text, /^((?:19|20)\d{2})/u, titleSeparator)) {
    return true;
  }
  if (/^\d{1,5}(?:\.|:)?\s*(?:port|service|端口)(?:\s|$)/iu.test(text)) {
    return true;
  }
  return false;
}

export function classifyOwnership(
  node: HeadingNode,
  expectedPrefix: string,
  format: Readonly<NumberingFormat> = DEFAULT_FORMAT,
): Ownership {
  return analyzeHeadingPrefix(node, expectedPrefix, format).ownership;
}

export interface HeadingPrefixAnalysis {
  readonly ownership: Ownership;
  readonly logicalTitle: string;
  readonly managedRange: SourceRange | null;
}

function formattedNumericPrefix(
  text: string,
  format: Readonly<NumberingFormat>,
): string | null {
  let cursor = 0;
  while (cursor < text.length && /[0-9]/u.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  if (cursor === 0) return null;

  while (text.startsWith(format.numberSeparator, cursor)) {
    const segmentStart = cursor + format.numberSeparator.length;
    let segmentEnd = segmentStart;
    while (segmentEnd < text.length && /[0-9]/u.test(text[segmentEnd] ?? "")) {
      segmentEnd += 1;
    }
    if (segmentEnd === segmentStart) break;
    cursor = segmentEnd;
  }

  return text.startsWith(format.titleSeparator, cursor)
    ? text.slice(0, cursor)
    : null;
}

export function analyzeHeadingPrefix(
  node: HeadingNode,
  expectedPrefix: string,
  format: Readonly<NumberingFormat> = DEFAULT_FORMAT,
): HeadingPrefixAnalysis {
  const leadingLength = node.rawText.length - node.rawText.trimStart().length;
  const text = node.rawText.trimStart();

  if (isSemanticNumericForm(text, format.titleSeparator)) {
    return { ownership: "semantic", logicalTitle: text, managedRange: null };
  }

  const managedPrefix = formattedNumericPrefix(text, format);
  if (managedPrefix !== null) {
    const managedRange = {
      from: node.contentRange.from + leadingLength,
      to:
        node.contentRange.from +
        leadingLength +
        managedPrefix.length +
        format.titleSeparator.length,
    };
    return {
      ownership: managedPrefix === expectedPrefix ? "exact" : "managed-stale",
      logicalTitle: text.slice(
        managedPrefix.length + format.titleSeparator.length,
      ),
      managedRange,
    };
  }

  const firstCodeUnit = text.charCodeAt(0);
  const startsWithAsciiDigit = firstCodeUnit >= 48 && firstCodeUnit <= 57;
  if (startsWithAsciiDigit && text.indexOf(format.titleSeparator, 1) !== -1) {
    return { ownership: "ambiguous", logicalTitle: text, managedRange: null };
  }

  const standardNumericChain = /^\d+(?:\.\d+)+/u.exec(text)?.[0];
  if (standardNumericChain) {
    return hasSemanticBoundary(
      text,
      standardNumericChain,
      format.titleSeparator,
    )
      ? { ownership: "semantic", logicalTitle: text, managedRange: null }
      : { ownership: "ambiguous", logicalTitle: text, managedRange: null };
  }

  if (/^\d+(?:\s|$)/u.test(text)) {
    return { ownership: "ambiguous", logicalTitle: text, managedRange: null };
  }

  return { ownership: "absent", logicalTitle: text, managedRange: null };
}

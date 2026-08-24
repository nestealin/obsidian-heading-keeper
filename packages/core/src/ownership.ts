import type { HeadingNode, NumberingFormat, Ownership } from "./types.js";

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
  const text = node.rawText.trimStart();

  if (isSemanticNumericForm(text, format.titleSeparator)) {
    return "semantic";
  }

  if (
    expectedPrefix.length > 0 &&
    text.startsWith(`${expectedPrefix}${format.titleSeparator}`)
  ) {
    return "exact";
  }

  const firstCodeUnit = text.charCodeAt(0);
  const startsWithAsciiDigit = firstCodeUnit >= 48 && firstCodeUnit <= 57;
  if (startsWithAsciiDigit && text.indexOf(format.titleSeparator, 1) !== -1) {
    return "ambiguous";
  }

  const standardNumericChain = /^\d+(?:\.\d+)+/u.exec(text)?.[0];
  if (standardNumericChain) {
    return hasSemanticBoundary(
      text,
      standardNumericChain,
      format.titleSeparator,
    )
      ? "semantic"
      : "ambiguous";
  }

  if (/^\d+(?:\s|$)/u.test(text)) {
    return "ambiguous";
  }

  return "absent";
}

import type { HeadingNode, Ownership } from "./types.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isIpv4Prefix(text: string): boolean {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\s|$)/u.exec(text);
  if (!match?.[1]) {
    return false;
  }
  return match[1].split(".").every((part) => Number(part) <= 255);
}

function isSemanticNumericForm(text: string): boolean {
  if (/^v\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?(?:\s|$)/iu.test(text)) {
    return true;
  }
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s|$)/u.test(text)) {
    return true;
  }
  if (isIpv4Prefix(text)) {
    return true;
  }
  if (/^(?:19|20)\d{2}(?:\.|\s|$)/u.test(text)) {
    return true;
  }
  if (/^\d{1,5}(?:\.|:)?\s*(?:port|service|端口)\b/iu.test(text)) {
    return true;
  }
  if (/^\d+\.\d+(?:\s|$)/u.test(text)) {
    return true;
  }
  if (/^\d+(?:\.\d+){2}(?:[-+][0-9A-Za-z.-]+)?(?:\s|$)/u.test(text)) {
    return true;
  }
  return false;
}

export function classifyOwnership(
  node: HeadingNode,
  expectedPrefix: string,
): Ownership {
  const text = node.rawText.trimStart();

  if (isSemanticNumericForm(text)) {
    return "semantic";
  }

  const exactPrefix = new RegExp(
    `^${escapeRegExp(expectedPrefix)}(?:\\.(?:\\s|$)|\\s)`,
    "u",
  );
  if (expectedPrefix.length > 0 && exactPrefix.test(text)) {
    return "exact";
  }

  if (
    /^(?:\d+(?:\.\d+)*)\.(?:\s|$)/u.test(text) ||
    /^\d+(?:\s|$)/u.test(text)
  ) {
    return "ambiguous";
  }

  return "absent";
}

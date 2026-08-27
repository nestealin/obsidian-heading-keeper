import {
  analyzeHeadingPrefix,
  buildNumberingPlan,
  scanHeadings,
  type NumberingSettings,
} from "@heading-keeper/core";

export interface ReadingPrefix {
  index: number;
  replaceCharacters?: number;
  text: string;
}

export interface ReadingSection {
  lineEnd: number;
  lineStart: number;
}

export interface ReadingDiagnostic {
  code:
    | "reading-heading-count-mismatch"
    | "reading-heading-mismatch"
    | "reading-section-info-invalid"
    | "reading-section-range-invalid";
  index: number;
  message: string;
}

export interface ReadingDecorationPlan {
  diagnostics: ReadingDiagnostic[];
  prefixes: ReadingPrefix[];
}

interface OwnedRoot {
  prefixes: Set<HTMLElement>;
  replacements: Array<{ hidden: string; node: Text }>;
  section: ReadingSection | null;
  sourcePath: string;
}

const ownedRoots = new WeakMap<HTMLElement, OwnedRoot>();
const registeredRoots = new Set<HTMLElement>();

function diagnostic(
  code: ReadingDiagnostic["code"],
  index: number,
  message: string,
): ReadingDecorationPlan {
  return { diagnostics: [{ code, index, message }], prefixes: [] };
}

function isSectionInfo(
  section: ReadingSection | null,
): section is ReadingSection {
  return (
    section !== null &&
    Number.isInteger(section.lineStart) &&
    Number.isInteger(section.lineEnd)
  );
}

function lineCount(markdown: string): number {
  return markdown === "" ? 0 : markdown.split(/\r\n|\n/u).length;
}

function contains(root: HTMLElement, element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current === root) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isInRange(line: number, range: ReadingSection): boolean {
  return line >= range.lineStart && line <= range.lineEnd;
}

function nestedSections(
  root: HTMLElement,
  sourcePath: string,
): ReadingSection[] {
  const sections: ReadingSection[] = [];
  for (const candidate of registeredRoots) {
    if (candidate === root || !contains(root, candidate)) {
      continue;
    }
    const ownedRoot = ownedRoots.get(candidate);
    if (ownedRoot?.sourcePath !== sourcePath) {
      continue;
    }
    const section = ownedRoot.section;
    if (isSectionInfo(section)) {
      sections.push(section);
    }
  }
  return sections;
}

function registerRoot(
  root: HTMLElement,
  section: ReadingSection | null,
  sourcePath: string,
): OwnedRoot {
  let ownedRoot = ownedRoots.get(root);
  if (!ownedRoot) {
    ownedRoot = {
      prefixes: new Set<HTMLElement>(),
      replacements: [],
      section,
      sourcePath,
    };
    ownedRoots.set(root, ownedRoot);
  } else {
    ownedRoot.section = section;
    ownedRoot.sourcePath = sourcePath;
  }

  for (const ancestor of registeredRoots) {
    if (ancestor === root || !contains(ancestor, root)) {
      continue;
    }
    const ancestorPrefixes = ownedRoots.get(ancestor)?.prefixes;
    if (!ancestorPrefixes) {
      continue;
    }
    for (const prefix of ancestorPrefixes) {
      if (contains(root, prefix)) {
        prefix.remove();
        ancestorPrefixes.delete(prefix);
      }
    }
  }
  registeredRoots.add(root);
  return ownedRoot;
}

export function registerReadingRoot(
  root: HTMLElement,
  section: ReadingSection | null,
  sourcePath: string,
): void {
  registerRoot(root, section, sourcePath);
}

function visibleHeadings(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
  ).filter(
    (heading) =>
      !Array.from(registeredRoots).some(
        (candidate) =>
          candidate !== root &&
          contains(root, candidate) &&
          contains(candidate, heading),
      ),
  );
}

export function planReadingDecorations(
  markdown: string,
  settings: NumberingSettings,
  visibleLevels: readonly number[],
  section: ReadingSection | null,
  excludedSections: readonly ReadingSection[] = [],
): ReadingDecorationPlan {
  if (!isSectionInfo(section)) {
    return diagnostic(
      "reading-section-info-invalid",
      0,
      "Reading section information is unavailable or invalid.",
    );
  }

  const sourceLineCount = lineCount(markdown);
  if (
    section.lineStart < 0 ||
    section.lineEnd < section.lineStart ||
    section.lineEnd >= sourceLineCount
  ) {
    return diagnostic(
      "reading-section-range-invalid",
      section.lineStart,
      "Reading section range is outside the source document.",
    );
  }

  const plan = buildNumberingPlan(scanHeadings(markdown), settings);
  const entries = plan.entries.filter(
    (entry) =>
      isInRange(entry.heading.line, section) &&
      !excludedSections.some((range) => isInRange(entry.heading.line, range)),
  );
  if (entries.length !== visibleLevels.length) {
    return diagnostic(
      "reading-heading-count-mismatch",
      Math.min(entries.length, visibleLevels.length),
      "Visible heading count does not match source heading count.",
    );
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.heading.level !== visibleLevels[index]) {
      return diagnostic(
        "reading-heading-mismatch",
        index,
        "Visible heading level does not match source heading level.",
      );
    }
  }

  const prefixes = entries.flatMap((entry, index) => {
    if (
      (entry.action !== "insert" && entry.action !== "replace") ||
      entry.displayPrefix === ""
    ) {
      return [];
    }
    const analysis = analyzeHeadingPrefix(
      entry.heading,
      entry.displayPrefix,
      plan.format,
    );
    return [
      {
        index,
        text: `${entry.displayPrefix}${plan.format.titleSeparator}`,
        ...(analysis.managedRange
          ? {
              replaceCharacters:
                analysis.managedRange.to - analysis.managedRange.from,
            }
          : {}),
      },
    ];
  });
  return { diagnostics: [], prefixes };
}

export function splitReadingPrefix(
  text: string,
  replaceCharacters: number,
): { hidden: string; visible: string } | null {
  if (
    !Number.isInteger(replaceCharacters) ||
    replaceCharacters <= 0 ||
    replaceCharacters > text.length
  ) {
    return null;
  }
  return {
    hidden: text.slice(0, replaceCharacters),
    visible: text.slice(replaceCharacters),
  };
}

function firstTextNode(heading: HTMLElement): Text | null {
  const createTreeWalker = heading.ownerDocument.createTreeWalker;
  if (typeof createTreeWalker !== "function") return null;
  const candidate = createTreeWalker
    .call(heading.ownerDocument, heading, 4)
    .nextNode();
  return candidate?.nodeType === 3 ? (candidate as Text) : null;
}

function replaceReadingSourcePrefix(
  heading: HTMLElement,
  replaceCharacters: number,
  ownedRoot: OwnedRoot,
): void {
  const node = firstTextNode(heading);
  if (!node) return;
  const split = splitReadingPrefix(node.data, replaceCharacters);
  if (!split) return;
  node.data = split.visible;
  ownedRoot.replacements.push({ hidden: split.hidden, node });
}

export function clearHeadingKeeperPrefixes(root: HTMLElement): void {
  const ownedRoot = ownedRoots.get(root);
  if (!ownedRoot) {
    return;
  }
  for (const prefix of ownedRoot.prefixes) {
    prefix.remove();
  }
  ownedRoot.prefixes.clear();
  for (const replacement of ownedRoot.replacements) {
    replacement.node.data = replacement.hidden + replacement.node.data;
  }
  ownedRoot.replacements.length = 0;
}

export function disposeReadingRoot(root: HTMLElement): void {
  clearHeadingKeeperPrefixes(root);
  ownedRoots.delete(root);
  registeredRoots.delete(root);
}

export function decorateReadingHeadings(
  root: HTMLElement,
  markdown: string,
  settings: NumberingSettings,
  section: ReadingSection | null,
  sourcePath = "",
): Pick<ReadingDecorationPlan, "diagnostics"> {
  const ownedRoot = registerRoot(root, section, sourcePath);
  clearHeadingKeeperPrefixes(root);
  const headings = visibleHeadings(root);
  const decorationPlan = planReadingDecorations(
    markdown,
    settings,
    headings.map((heading) => Number(heading.tagName.slice(1))),
    section,
    nestedSections(root, sourcePath),
  );

  for (const prefix of decorationPlan.prefixes) {
    const heading = headings[prefix.index];
    if (!heading) {
      continue;
    }
    if (prefix.replaceCharacters !== undefined) {
      replaceReadingSourcePrefix(heading, prefix.replaceCharacters, ownedRoot);
    }
    const element = root.ownerDocument.createElement("span");
    element.className = "heading-keeper-prefix";
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("data-heading-keeper-owner", "true");
    element.textContent = prefix.text;
    heading.insertBefore(element, heading.firstChild);
    ownedRoot.prefixes.add(element);
  }

  return { diagnostics: decorationPlan.diagnostics };
}

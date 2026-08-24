import {
  buildNumberingPlan,
  scanHeadings,
  type NumberingSettings,
} from "@heading-numbering/core";

export interface ReadingPrefix {
  index: number;
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
  section: ReadingSection | null;
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

function nestedSections(root: HTMLElement): ReadingSection[] {
  const sections: ReadingSection[] = [];
  for (const candidate of registeredRoots) {
    if (candidate === root || !contains(root, candidate)) {
      continue;
    }
    const section = ownedRoots.get(candidate)?.section ?? null;
    if (isSectionInfo(section)) {
      sections.push(section);
    }
  }
  return sections;
}

function registerRoot(
  root: HTMLElement,
  section: ReadingSection | null,
): OwnedRoot {
  let ownedRoot = ownedRoots.get(root);
  if (!ownedRoot) {
    ownedRoot = { prefixes: new Set<HTMLElement>(), section };
    ownedRoots.set(root, ownedRoot);
  } else {
    ownedRoot.section = section;
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
): void {
  registerRoot(root, section);
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
    if (entry.action !== "insert" || entry.displayPrefix === "") {
      return [];
    }
    return [
      {
        index,
        text: `${entry.displayPrefix}${plan.format.titleSeparator}`,
      },
    ];
  });
  return { diagnostics: [], prefixes };
}

export function clearHeadingNumberingPrefixes(root: HTMLElement): void {
  const prefixes = ownedRoots.get(root)?.prefixes;
  if (!prefixes) {
    return;
  }
  for (const prefix of prefixes) {
    prefix.remove();
  }
  prefixes.clear();
}

export function disposeReadingRoot(root: HTMLElement): void {
  clearHeadingNumberingPrefixes(root);
  ownedRoots.delete(root);
  registeredRoots.delete(root);
}

export function decorateReadingHeadings(
  root: HTMLElement,
  markdown: string,
  settings: NumberingSettings,
  section: ReadingSection | null,
): Pick<ReadingDecorationPlan, "diagnostics"> {
  const ownedRoot = registerRoot(root, section);
  clearHeadingNumberingPrefixes(root);
  const headings = visibleHeadings(root);
  const decorationPlan = planReadingDecorations(
    markdown,
    settings,
    headings.map((heading) => Number(heading.tagName.slice(1))),
    section,
    nestedSections(root),
  );

  for (const prefix of decorationPlan.prefixes) {
    const heading = headings[prefix.index];
    if (!heading) {
      continue;
    }
    const element = root.ownerDocument.createElement("span");
    element.className = "heading-numbering-prefix";
    element.setAttribute("aria-hidden", "true");
    element.setAttribute("data-heading-numbering-owner", "true");
    element.textContent = prefix.text;
    heading.insertBefore(element, heading.firstChild);
    ownedRoot.prefixes.add(element);
  }

  return { diagnostics: decorationPlan.diagnostics };
}

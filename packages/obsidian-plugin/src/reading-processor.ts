import {
  buildNumberingPlan,
  scanHeadings,
  type NumberingSettings,
} from "@heading-numbering/core";

export interface ReadingPrefix {
  index: number;
  text: string;
}

export interface ReadingDiagnostic {
  code: "reading-heading-count-mismatch" | "reading-heading-mismatch";
  index: number;
  message: string;
}

export interface ReadingDecorationPlan {
  diagnostics: ReadingDiagnostic[];
  prefixes: ReadingPrefix[];
}

export function planReadingDecorations(
  markdown: string,
  settings: NumberingSettings,
  visibleLevels: readonly number[],
): ReadingDecorationPlan {
  const plan = buildNumberingPlan(scanHeadings(markdown), settings);
  const diagnostics: ReadingDiagnostic[] = [];
  const prefixes: ReadingPrefix[] = [];
  const commonLength = Math.min(plan.entries.length, visibleLevels.length);

  for (let index = 0; index < commonLength; index += 1) {
    const entry = plan.entries[index];
    if (!entry || entry.heading.level !== visibleLevels[index]) {
      diagnostics.push({
        code: "reading-heading-mismatch",
        index,
        message: "Visible heading level does not match source heading level.",
      });
      break;
    }
    if (entry.action === "insert" && entry.displayPrefix !== "") {
      prefixes.push({
        index,
        text: `${entry.displayPrefix}${plan.format.titleSeparator}`,
      });
    }
  }

  if (
    diagnostics.length === 0 &&
    plan.entries.length !== visibleLevels.length
  ) {
    diagnostics.push({
      code: "reading-heading-count-mismatch",
      index: commonLength,
      message: "Visible heading count does not match source heading count.",
    });
  }

  return { diagnostics, prefixes };
}

export function clearHeadingNumberingPrefixes(root: HTMLElement): void {
  for (const prefix of root.querySelectorAll(".heading-numbering-prefix")) {
    prefix.remove();
  }
}

export function decorateReadingHeadings(
  root: HTMLElement,
  markdown: string,
  settings: NumberingSettings,
): Pick<ReadingDecorationPlan, "diagnostics"> {
  clearHeadingNumberingPrefixes(root);
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const decorationPlan = planReadingDecorations(
    markdown,
    settings,
    headings.map((heading) => Number(heading.tagName.slice(1))),
  );

  for (const prefix of decorationPlan.prefixes) {
    const heading = headings[prefix.index];
    if (!heading) {
      continue;
    }
    const element = root.ownerDocument.createElement("span");
    element.className = "heading-numbering-prefix";
    element.setAttribute("aria-hidden", "true");
    element.textContent = prefix.text;
    heading.insertBefore(element, heading.firstChild);
  }

  return { diagnostics: decorationPlan.diagnostics };
}

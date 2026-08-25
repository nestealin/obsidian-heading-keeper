import { scanHeadings } from "./scanner.js";

export type UnsafeHeadingRenameReason =
  | "unchanged-headings"
  | "structure-changed"
  | "level-changed"
  | "multiple-heading-changes"
  | "empty-heading"
  | "duplicate-old-heading"
  | "duplicate-new-heading";

export type SafeHeadingRenameDetection =
  | {
      readonly kind: "safe";
      readonly rename: {
        readonly oldHeading: string;
        readonly newHeading: string;
      };
    }
  | { readonly kind: "none"; readonly reason: UnsafeHeadingRenameReason };

function headingIdentity(text: string): string {
  return text.trim().normalize("NFC");
}

function identityCount(headings: readonly { semanticText: string }[]) {
  const counts = new Map<string, number>();
  for (const heading of headings) {
    const identity = headingIdentity(heading.semanticText);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return counts;
}

export function detectSafeHeadingRename(
  beforeText: string,
  afterText: string,
): SafeHeadingRenameDetection {
  const before = scanHeadings(beforeText);
  const after = scanHeadings(afterText);
  if (before.length !== after.length) {
    return { kind: "none", reason: "structure-changed" };
  }

  const changed: number[] = [];
  for (let index = 0; index < before.length; index += 1) {
    const oldHeading = before[index]!;
    const newHeading = after[index]!;
    if (oldHeading.level !== newHeading.level) {
      return { kind: "none", reason: "level-changed" };
    }
    if (
      headingIdentity(oldHeading.semanticText) !==
      headingIdentity(newHeading.semanticText)
    ) {
      changed.push(index);
    }
  }

  if (changed.length === 0) {
    return { kind: "none", reason: "unchanged-headings" };
  }
  if (changed.length !== 1) {
    return { kind: "none", reason: "multiple-heading-changes" };
  }

  const index = changed[0]!;
  const oldHeading = headingIdentity(before[index]!.semanticText);
  const newHeading = headingIdentity(after[index]!.semanticText);
  if (oldHeading.length === 0 || newHeading.length === 0) {
    return { kind: "none", reason: "empty-heading" };
  }
  if ((identityCount(before).get(oldHeading) ?? 0) !== 1) {
    return { kind: "none", reason: "duplicate-old-heading" };
  }
  if ((identityCount(after).get(newHeading) ?? 0) !== 1) {
    return { kind: "none", reason: "duplicate-new-heading" };
  }

  return {
    kind: "safe",
    rename: { oldHeading, newHeading },
  };
}

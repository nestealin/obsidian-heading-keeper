import { normalizeHeadingFragment } from "@heading-keeper/link-core";

export interface HeadingLinkRecord {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly fragment: string;
  readonly kind: "link" | "embed";
}

function key(targetPath: string, fragment: string): string {
  return `${targetPath}\u0000${fragment}`;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class ReverseHeadingLinkIndex {
  private readonly recordsBySource = new Map<string, HeadingLinkRecord[]>();
  private readonly sourcesByTargetFragment = new Map<string, Set<string>>();

  rebuild(records: readonly HeadingLinkRecord[]): void {
    this.recordsBySource.clear();
    this.sourcesByTargetFragment.clear();
    const grouped = new Map<string, HeadingLinkRecord[]>();
    for (const record of records) {
      const list = grouped.get(record.sourcePath) ?? [];
      list.push(record);
      grouped.set(record.sourcePath, list);
    }
    for (const sourceRecords of grouped.values()) {
      this.updateSource(sourceRecords);
    }
  }

  updateSource(records: readonly HeadingLinkRecord[]): void {
    if (records.length === 0) return;
    const sourcePath = records[0]!.sourcePath;
    if (records.some((record) => record.sourcePath !== sourcePath)) {
      throw new Error("mixed-source-records");
    }
    this.deleteSource(sourcePath);
    const normalized: HeadingLinkRecord[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      const fragment = normalizeHeadingFragment(record.fragment);
      if (!fragment.ok || fragment.value.startsWith("^")) continue;
      const recordKey = `${record.targetPath}\u0000${fragment.value}\u0000${record.kind}`;
      if (seen.has(recordKey)) continue;
      seen.add(recordKey);
      const stored = { ...record, fragment: fragment.value };
      normalized.push(stored);
      const reverseKey = key(stored.targetPath, stored.fragment);
      const sources = this.sourcesByTargetFragment.get(reverseKey) ?? new Set();
      sources.add(sourcePath);
      this.sourcesByTargetFragment.set(reverseKey, sources);
    }
    this.recordsBySource.set(sourcePath, normalized);
  }

  renameSource(oldPath: string, newPath: string): void {
    const all = [...this.recordsBySource.values()].flat().map((record) => ({
      ...record,
      sourcePath: record.sourcePath === oldPath ? newPath : record.sourcePath,
      targetPath: record.targetPath === oldPath ? newPath : record.targetPath,
    }));
    this.rebuild(all);
  }

  deleteSource(path: string): void {
    const previous = this.recordsBySource.get(path);
    if (!previous) return;
    for (const record of previous) {
      const reverseKey = key(record.targetPath, record.fragment);
      const sources = this.sourcesByTargetFragment.get(reverseKey);
      sources?.delete(path);
      if (sources?.size === 0) this.sourcesByTargetFragment.delete(reverseKey);
    }
    this.recordsBySource.delete(path);
  }

  candidates(targetPath: string, fragments: readonly string[]): string[] {
    const candidates = new Set<string>();
    for (const raw of fragments) {
      const fragment = normalizeHeadingFragment(raw);
      if (!fragment.ok || fragment.value.startsWith("^")) continue;
      for (const source of this.sourcesByTargetFragment.get(
        key(targetPath, fragment.value),
      ) ?? []) {
        candidates.add(source);
      }
    }
    return [...candidates].sort(compareCodeUnits);
  }
}

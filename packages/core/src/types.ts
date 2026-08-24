export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type GapStrategy = "compact" | "preserve";

export interface NumberingSettings {
  topLevel: HeadingLevel;
  bottomLevel: HeadingLevel;
  startAt: number;
  numberSeparator: string;
  titleSeparator: string;
  gapStrategy: GapStrategy;
}

export interface FieldError {
  field: string;
  message: string;
}

export type SettingsValidation =
  | { ok: true; value: NumberingSettings }
  | { ok: false; errors: FieldError[] };

export interface TextRange {
  from: number;
  to: number;
}

export interface HeadingNode {
  level: HeadingLevel;
  line: number;
  indent: string;
  marker: string;
  rawText: string;
  semanticText: string;
  sourceRange: TextRange;
  contentRange: TextRange;
  closingSequence: string;
  lineEnding: string;
}

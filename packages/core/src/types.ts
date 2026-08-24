export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type GapStrategy = "zero-fill" | "one-fill" | "compact" | "skip";

export type Ownership = "absent" | "exact" | "semantic" | "ambiguous";

export type PlannedAction =
  | "decorate"
  | "insert"
  | "replace"
  | "preserve"
  | "skip";

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

export interface SourceRange {
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
  sourceRange: SourceRange;
  contentRange: SourceRange;
  closingSequence: string;
  lineEnding: "" | "\n" | "\r\n";
}

export interface TextEdit {
  range: SourceRange;
  expectedText: string;
  replacementText: string;
}

export interface NumberingFormat {
  readonly numberSeparator: string;
  readonly titleSeparator: string;
}

export interface NumberingPlanEntry {
  heading: HeadingNode;
  segments: number[];
  displayPrefix: string;
  ownership: Ownership;
  action: PlannedAction;
  reason: string;
  edit?: TextEdit;
}

export interface PlanDiagnostic {
  code: string;
  message: string;
  line: number;
  sourceRange: SourceRange;
}

export interface NumberingPlan {
  readonly format: NumberingFormat;
  entries: NumberingPlanEntry[];
  diagnostics: PlanDiagnostic[];
}

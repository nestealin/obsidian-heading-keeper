export const packageIdentity = Object.freeze({
  id: "heading-keeper",
  version: "0.2.1",
});

export { DEFAULT_SETTINGS, validateSettings } from "./settings.js";
export { scanHeadings } from "./scanner.js";
export { detectSafeHeadingRename } from "./heading-rename.js";
export type {
  SafeHeadingRenameDetection,
  UnsafeHeadingRenameReason,
} from "./heading-rename.js";
export { buildNumberingPlan, NumberingOverflowError } from "./numbering.js";
export {
  analyzeHeadingPrefix,
  classifyOwnership,
  type HeadingPrefixAnalysis,
} from "./ownership.js";
export { applyPlan, StalePlanError } from "./plan.js";
export type { StalePlanCode } from "./plan.js";
export type {
  FieldError,
  GapStrategy,
  HeadingLevel,
  HeadingNode,
  NumberingPlan,
  NumberingPlanEntry,
  NumberingFormat,
  NumberingSettings,
  Ownership,
  PlanDiagnostic,
  PlannedAction,
  SettingsValidation,
  SourceRange,
  TextEdit,
} from "./types.js";

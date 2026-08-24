export const packageIdentity = Object.freeze({
  id: "heading-numbering",
  version: "0.1.0",
});

export { DEFAULT_SETTINGS, validateSettings } from "./settings.js";
export { scanHeadings } from "./scanner.js";
export { buildNumberingPlan } from "./numbering.js";
export { classifyOwnership } from "./ownership.js";
export { applyPlan, StalePlanError } from "./plan.js";
export type { StalePlanCode } from "./plan.js";
export type {
  FieldError,
  GapStrategy,
  HeadingLevel,
  HeadingNode,
  NumberingPlan,
  NumberingPlanEntry,
  NumberingSettings,
  Ownership,
  PlanDiagnostic,
  PlannedAction,
  SettingsValidation,
  SourceRange,
  TextEdit,
} from "./types.js";

export { normalizeHeadingFragment } from "./fragments.js";
export {
  planHeadingLinkChanges,
  planRenameScopedLinkChanges,
} from "./planner.js";
export { scanHeadingLinks } from "./tokenizer.js";
export { auditHeadingLinks } from "./audit.js";
export { LINK_DIAGNOSTIC_CODES } from "./types.js";
export type {
  FragmentNormalization,
  HeadingRename,
  LinkDiagnostic,
  LinkDiagnosticCode,
  LinkEdit,
  LinkKind,
  LinkPlan,
  LinkToken,
  PlanHeadingLinkChangesInput,
  ResolvedTarget,
} from "./types.js";
export type {
  HeadingLinkAuditCode,
  HeadingLinkAuditFinding,
  HeadingLinkAuditInput,
  HeadingLinkAuditResult,
  HeadingLinkAuditSource,
} from "./audit.js";

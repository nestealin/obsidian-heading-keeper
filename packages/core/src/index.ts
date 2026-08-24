export const packageIdentity = Object.freeze({
  id: "heading-numbering",
  version: "0.1.0",
});

export { DEFAULT_SETTINGS, validateSettings } from "./settings.js";
export { scanHeadings } from "./scanner.js";
export type {
  FieldError,
  GapStrategy,
  HeadingLevel,
  HeadingNode,
  NumberingSettings,
  SettingsValidation,
  SourceRange,
} from "./types.js";

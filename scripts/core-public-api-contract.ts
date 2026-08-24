import type { GapStrategy } from "../packages/core/src/index.js";

const supportedStrategies: readonly GapStrategy[] = [
  "zero-fill",
  "one-fill",
  "compact",
  "skip",
];

void supportedStrategies;

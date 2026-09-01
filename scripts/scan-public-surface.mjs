import { readTextSourceFiles } from "./scan-source-files.mjs";
import {
  forbiddenPublicPaths,
  hasNonPublicContent,
} from "./public-surface-rules.mjs";

const findings = new Set();

for (const { content, file } of await readTextSourceFiles()) {
  if (forbiddenPublicPaths.some((pattern) => pattern.test(file))) {
    findings.add(file);
  }
  if (hasNonPublicContent(content)) {
    findings.add(file);
  }
}

if (findings.size > 0) {
  process.stderr.write(
    `Non-public content found in:\n${[...findings].sort().join("\n")}\n`,
  );
  process.exitCode = 1;
}

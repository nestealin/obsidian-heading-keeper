import { readTextReleaseFiles } from "./scan-source-files.mjs";

const wordJoiner = String.fromCodePoint(0x2060);
const findings = [];

for (const { content, file } of await readTextReleaseFiles()) {
  if (content.includes(wordJoiner)) findings.push(file);
}

if (findings.length > 0) {
  process.stderr.write(`Word joiner found in:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
}

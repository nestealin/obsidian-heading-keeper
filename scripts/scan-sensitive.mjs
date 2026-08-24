import { readTextReleaseFiles } from "./scan-source-files.mjs";

const findings = [];
const patterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"'\s]{8,}/iu,
];

for (const { content, file } of await readTextReleaseFiles()) {
  if (
    content.includes("\u2060") ||
    patterns.some((pattern) => pattern.test(content))
  ) {
    findings.push(file);
  }
}

if (findings.length > 0) {
  process.stderr.write(`Sensitive content found in:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
}

import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "buffer" },
)
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const findings = [];
const patterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"'\s]{8,}/iu,
];

for (const file of files) {
  const content = await readFile(file, "utf8");
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

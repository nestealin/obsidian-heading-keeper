import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const terms = process.argv.slice(2).filter((term) => term.length > 0);

if (terms.length === 0) {
  process.stderr.write(
    "Usage: node scripts/scan-rejected.mjs <term> [...term]\n",
  );
  process.exit(2);
}

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "buffer" },
)
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const findings = [];

for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const term of terms) {
    if (content.includes(term)) findings.push(`${file}: ${term}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`Rejected terms found:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
}

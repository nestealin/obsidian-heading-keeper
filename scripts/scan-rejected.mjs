import { readTextSourceFiles } from "./scan-source-files.mjs";

const rawTerms = process.argv.slice(2);
const terms = (rawTerms[0] === "--" ? rawTerms.slice(1) : rawTerms).filter(
  (term) => term.length > 0,
);

if (terms.length === 0) {
  process.stderr.write(
    "Usage: node scripts/scan-rejected.mjs <term> [...term]\n",
  );
  process.exit(2);
}

const findings = [];

for (const { content, file } of await readTextSourceFiles()) {
  for (const term of terms) {
    if (content.includes(term)) findings.push(`${file}: ${term}`);
  }
}

if (findings.length > 0) {
  process.stderr.write(`Rejected terms found:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
}

import { readTextSourceFiles } from "./scan-source-files.mjs";

const rawTerms = process.argv.slice(2);
const commandTerms = (
  rawTerms[0] === "--" ? rawTerms.slice(1) : rawTerms
).filter((term) => term.length > 0);

function usage() {
  process.stderr.write(
    "Usage: node scripts/scan-rejected.mjs <term> [...term] or REJECTED_TERMS_JSON='[\"term\"]'\n",
  );
  process.exit(2);
}

function environmentTerms() {
  if (!process.env.REJECTED_TERMS_JSON) return [];
  try {
    const terms = JSON.parse(process.env.REJECTED_TERMS_JSON);
    if (
      !Array.isArray(terms) ||
      terms.length === 0 ||
      terms.some((term) => typeof term !== "string" || term.length === 0)
    ) {
      usage();
    }
    return terms;
  } catch {
    usage();
  }
}

const terms = commandTerms.length > 0 ? commandTerms : environmentTerms();

if (terms.length === 0) {
  usage();
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

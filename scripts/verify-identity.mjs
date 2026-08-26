import { resolve } from "node:path";
import { readTextSourceFiles } from "./scan-source-files.mjs";

function parseRoot(arguments_) {
  if (arguments_.length === 0) return process.cwd();
  if (arguments_.length === 2 && arguments_[0] === "--root") {
    return resolve(arguments_[1]);
  }
  process.stderr.write(
    "Usage: node scripts/verify-identity.mjs [--root <repository>]\n",
  );
  process.exit(2);
}

const root = parseRoot(process.argv.slice(2));
const parts = ["heading", "numbering"];
const retiredForms = [
  parts.join("-"),
  parts.join("_"),
  parts.join(" "),
  parts.join(""),
];
const findings = [];

if (retiredForms.some((term) => root.toLowerCase().includes(term))) {
  findings.push(`${root}: path`);
}

for (const { content, file } of await readTextSourceFiles(root)) {
  const normalizedPath = file.toLowerCase();
  const normalizedContent = content.toLowerCase();
  if (retiredForms.some((term) => normalizedPath.includes(term))) {
    findings.push(`${file}: path`);
  }
  if (retiredForms.some((term) => normalizedContent.includes(term))) {
    findings.push(`${file}: content`);
  }
}

if (findings.length > 0) {
  process.stderr.write(
    `Retired product identity found:\n${findings.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Heading Keeper identity verification passed.\n");
}

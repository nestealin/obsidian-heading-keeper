import { execFileSync } from "node:child_process";
import { isBinaryContent } from "./scan-source-files.mjs";
import {
  forbiddenPublicPaths,
  hasNonPublicContent,
} from "./public-surface-rules.mjs";

const revision = process.argv[2] ?? "HEAD";
const objects = execFileSync("git", ["rev-list", "--objects", revision], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const pathsByObject = new Map();
const findings = new Set();

for (const line of objects.split("\n")) {
  if (!line) continue;
  const separator = line.indexOf(" ");
  if (separator < 0) continue;
  const object = line.slice(0, separator);
  const path = line.slice(separator + 1);
  if (!pathsByObject.has(object)) pathsByObject.set(object, path);
  if (forbiddenPublicPaths.some((pattern) => pattern.test(path))) {
    findings.add(path);
  }
}

for (const [object, path] of pathsByObject) {
  const type = execFileSync("git", ["cat-file", "-t", object], {
    encoding: "utf8",
  }).trim();
  if (type !== "blob") continue;
  const content = execFileSync("git", ["cat-file", "blob", object], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (isBinaryContent(content)) continue;
  if (hasNonPublicContent(content.toString("utf8"))) findings.add(path);
}

if (findings.size > 0) {
  process.stderr.write(
    `Non-public history found in:\n${[...findings].sort().join("\n")}\n`,
  );
  process.exitCode = 1;
}

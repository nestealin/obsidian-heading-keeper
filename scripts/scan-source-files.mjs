import { isUtf8 } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const releaseAssetPaths = [
  "packages/obsidian-plugin/main.js",
  "packages/obsidian-plugin/manifest.json",
  "packages/obsidian-plugin/versions.json",
];

export function isBinaryContent(content) {
  if (content.includes(0) || !isUtf8(content)) return true;

  let controlBytes = 0;
  for (const byte of content) {
    if (
      (byte >= 1 && byte <= 8) ||
      (byte >= 14 && byte <= 31) ||
      byte === 127
    ) {
      controlBytes += 1;
    }
  }
  return content.length > 0 && controlBytes / content.length > 0.3;
}

export async function readTextSourceFiles(root = process.cwd()) {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "buffer" },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const textFiles = [];

  for (const file of files) {
    const content = await readFile(resolve(root, file));
    if (!isBinaryContent(content))
      textFiles.push({ content: content.toString("utf8"), file });
  }

  return textFiles;
}

export async function readTextReleaseFiles(root = process.cwd()) {
  const textFiles = await readTextSourceFiles(root);
  const knownFiles = new Set(textFiles.map(({ file }) => file));

  for (const file of releaseAssetPaths) {
    if (knownFiles.has(file)) continue;
    try {
      const content = await readFile(resolve(root, file));
      if (!isBinaryContent(content)) {
        textFiles.push({ content: content.toString("utf8"), file });
      }
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return textFiles;
}

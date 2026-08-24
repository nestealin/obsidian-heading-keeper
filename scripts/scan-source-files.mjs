import { isUtf8 } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

function isBinaryContent(content) {
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

export async function readTextSourceFiles() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "buffer" },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const textFiles = [];

  for (const file of files) {
    const content = await readFile(file);
    if (!isBinaryContent(content))
      textFiles.push({ content: content.toString("utf8"), file });
  }

  return textFiles;
}

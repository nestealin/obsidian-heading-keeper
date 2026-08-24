import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const pluginDirectory = join(repositoryRoot, "packages/obsidian-plugin");
const assets = ["main.js", "manifest.json", "versions.json"];
const allowedEntries = new Set([...assets, "data.json"]);
const deploymentDirectory = process.argv[2];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function requireFile(path) {
  try {
    const status = await lstat(path);
    if (!status.isFile()) fail(`Expected regular file: ${path}`);
    return await readFile(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      fail(`Missing required asset: ${path}`);
    }
    throw error;
  }
}

if (!deploymentDirectory) {
  process.stderr.write("Usage: node scripts/verify-deployment.mjs <dir>\n");
  process.exit(2);
}

const deployed = resolve(deploymentDirectory);
try {
  const status = await lstat(deployed);
  if (!status.isDirectory())
    fail(`Deployment path is not a directory: ${deployed}`);
} catch (error) {
  if (error && typeof error === "object" && error.code === "ENOENT") {
    fail(`Deployment directory does not exist: ${deployed}`);
  }
  throw error;
}

execFileSync(
  "corepack",
  ["pnpm", "--filter", "@heading-numbering/obsidian-plugin", "build"],
  { cwd: repositoryRoot, stdio: "inherit" },
);

const deployedNames = await readdir(deployed);
for (const name of deployedNames) {
  if (!allowedEntries.has(name)) fail(`Unexpected deployment entry: ${name}`);
  const entryStatus = await lstat(join(deployed, name));
  if (!entryStatus.isFile())
    fail(`Expected regular file: ${join(deployed, name)}`);
}

for (const name of assets) {
  const source = await requireFile(join(pluginDirectory, name));
  const target = await requireFile(join(deployed, name));
  const sourceHash = sha256(source);
  const targetHash = sha256(target);
  if (sourceHash !== targetHash) fail(`Deployment hash mismatch: ${name}`);
  process.stdout.write(`${name} sha256=${sourceHash}\n`);
}

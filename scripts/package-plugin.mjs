import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDirectory = join(repositoryRoot, "packages/obsidian-plugin");
const artifact = join(repositoryRoot, "artifacts/heading-keeper-0.2.1.zip");
const assetNames = ["main.js", "manifest.json", "versions.json"];
const assetPaths = new Map([
  ["main.js", join(pluginDirectory, "main.js")],
  ["manifest.json", join(repositoryRoot, "manifest.json")],
  ["versions.json", join(repositoryRoot, "versions.json")],
]);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function crc32(content) {
  let crc = 0xffffffff;
  for (const byte of content) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function zipEntry(name, content, offset) {
  const nameBytes = Buffer.from(name, "utf8");
  const crc = crc32(content);
  const size = content.length;
  const local = Buffer.concat([
    writeUInt32(0x04034b50),
    writeUInt16(20),
    writeUInt16(0x0800),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0x0021),
    writeUInt32(crc),
    writeUInt32(size),
    writeUInt32(size),
    writeUInt16(nameBytes.length),
    writeUInt16(0),
    nameBytes,
    content,
  ]);
  const central = Buffer.concat([
    writeUInt32(0x02014b50),
    writeUInt16((3 << 8) | 20),
    writeUInt16(20),
    writeUInt16(0x0800),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0x0021),
    writeUInt32(crc),
    writeUInt32(size),
    writeUInt32(size),
    writeUInt16(nameBytes.length),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt32(0o100644 << 16),
    writeUInt32(offset),
    nameBytes,
  ]);
  return { central, local };
}

async function packagePlugin() {
  execFileSync(
    "corepack",
    ["pnpm", "--filter", "@heading-keeper/obsidian-plugin...", "build"],
    { cwd: repositoryRoot, stdio: "inherit" },
  );
  const entries = [];
  let offset = 0;
  for (const name of assetNames) {
    const source = assetPaths.get(name);
    if (!source) throw new Error(`Missing release source for ${name}.`);
    const entry = zipEntry(name, await readFile(source), offset);
    entries.push(entry);
    offset += entry.local.length;
  }
  const central = Buffer.concat(entries.map((entry) => entry.central));
  const end = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(central.length),
    writeUInt32(offset),
    writeUInt16(0),
  ]);
  await mkdir(dirname(artifact), { recursive: true });
  const archive = Buffer.concat([
    ...entries.map((entry) => entry.local),
    central,
    end,
  ]);
  await writeFile(artifact, archive);
  process.stdout.write(`${artifact} sha256=${sha256(archive)}\n`);
}

await packagePlugin();

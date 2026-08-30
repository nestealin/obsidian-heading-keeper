import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const artifact = join(repositoryRoot, "artifacts/heading-keeper-0.2.0.zip");
const packageScript = join(repositoryRoot, "scripts/package-plugin.mjs");
const releaseRejectedScript = join(
  repositoryRoot,
  "scripts/verify-release-rejected.mjs",
);
const identityScript = join(repositoryRoot, "scripts/verify-identity.mjs");
const sensitiveScript = join(repositoryRoot, "scripts/scan-sensitive.mjs");
const verifyDeploymentScript = join(
  repositoryRoot,
  "scripts/verify-deployment.mjs",
);
const wordJoinerScript = join(repositoryRoot, "scripts/scan-word-joiner.mjs");
const pluginDirectory = join(repositoryRoot, "packages/obsidian-plugin");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

function run(
  script: string,
  arguments_: string[] = [],
  environment: NodeJS.ProcessEnv = {},
) {
  const env = { ...process.env, ...environment };
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete env[key];
  }
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env,
  });
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function crc32(content: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseZipEntries(content: Buffer) {
  let eocd = -1;
  for (let offset = content.length - 22; offset >= 0; offset -= 1) {
    if (content.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP end record is missing.");

  const entries = [] as Array<{
    crc: number;
    data: Buffer;
    mode: number;
    name: string;
  }>;
  let offset = content.readUInt32LE(eocd + 16);
  const count = content.readUInt16LE(eocd + 10);
  for (let index = 0; index < count; index += 1) {
    if (content.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP central directory record is invalid.");
    }
    const compression = content.readUInt16LE(offset + 10);
    const crc = content.readUInt32LE(offset + 16);
    const compressedSize = content.readUInt32LE(offset + 20);
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const mode = content.readUInt32LE(offset + 38) >>> 16;
    const localOffset = content.readUInt32LE(offset + 42);
    const name = content.toString(
      "utf8",
      offset + 46,
      offset + 46 + nameLength,
    );
    const localNameLength = content.readUInt16LE(localOffset + 26);
    const localExtraLength = content.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({
      crc,
      data: content.subarray(dataStart, dataStart + compressedSize),
      mode,
      name,
    });
    expect(compression).toBe(0);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function deploymentDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "heading-keeper-deploy-"));
  temporaryDirectories.push(directory);
  for (const name of ["main.js", "manifest.json", "versions.json"]) {
    await cp(join(pluginDirectory, name), join(directory, name));
  }
  return directory;
}

describe("release surface", () => {
  it("keeps reciprocal English and Chinese README navigation resolvable", async () => {
    const englishPath = join(repositoryRoot, "README.md");
    const chinesePath = join(repositoryRoot, "README.zh-CN.md");

    expect(existsSync(chinesePath)).toBe(true);

    const english = await readFile(englishPath, "utf8");
    const chinese = await readFile(chinesePath, "utf8");
    expect(english).toContain("English | [简体中文](README.zh-CN.md)");
    expect(chinese).toContain("[English](README.md) | 简体中文");
    expect(resolve(dirname(englishPath), "README.zh-CN.md")).toBe(chinesePath);
    expect(resolve(dirname(chinesePath), "README.md")).toBe(englishPath);
  });

  it("keeps version 0.2.0 aligned across every release identity", async () => {
    const paths = [
      "package.json",
      "manifest.json",
      "packages/core/package.json",
      "packages/link-core/package.json",
      "packages/obsidian-plugin/package.json",
      "packages/obsidian-plugin/manifest.json",
    ];
    const versions = await Promise.all(
      paths.map(async (path) =>
        JSON.parse(await readFile(join(repositoryRoot, path), "utf8")),
      ),
    );
    expect(versions.map((value) => value.version)).toEqual(
      paths.map(() => "0.2.0"),
    );
    const coreIdentity = await readFile(
      join(repositoryRoot, "packages/core/src/index.ts"),
      "utf8",
    );
    expect(coreIdentity).toContain('version: "0.2.0"');

    const rootManifestText = await readFile(
      join(repositoryRoot, "manifest.json"),
      "utf8",
    );
    const rootManifest = JSON.parse(rootManifestText) as Record<
      string,
      unknown
    >;
    expect(rootManifestText).toBe(
      await readFile(
        join(repositoryRoot, "packages/obsidian-plugin/manifest.json"),
        "utf8",
      ),
    );
    expect(rootManifest).toMatchObject({
      author: "nestealin",
      description:
        "Keep heading numbers and heading-fragment links coherent with conservative, recoverable updates.",
      id: "heading-keeper",
      isDesktopOnly: false,
      minAppVersion: "1.12.7",
      name: "Heading Keeper",
      version: "0.2.0",
    });
    expect(rootManifest.id).toMatch(/^[a-z0-9-]+$/u);
    expect(String(rootManifest.id)).not.toContain("obsidian");
    expect(String(rootManifest.id)).not.toMatch(/plugin$/u);
    expect(String(rootManifest.name)).not.toMatch(/obsidian|plugin/iu);
    expect(String(rootManifest.description).length).toBeLessThanOrEqual(250);
    expect(String(rootManifest.description)).toMatch(/\.$/u);
    expect(await readFile(join(repositoryRoot, "versions.json"), "utf8")).toBe(
      await readFile(
        join(repositoryRoot, "packages/obsidian-plugin/versions.json"),
        "utf8",
      ),
    );

    const readme = await readFile(join(repositoryRoot, "README.md"), "utf8");
    expect(readme).toContain("public community plugin");
    expect(readme).not.toContain("closed beta");
    expect(readme).not.toContain("private-test build");
    expect(await readFile(join(repositoryRoot, "LICENSE"), "utf8")).toContain(
      "MIT License",
    );

    const persistenceTypes = await readFile(
      join(repositoryRoot, "packages/obsidian-plugin/src/persistence/types.ts"),
      "utf8",
    );
    const plannedFile =
      /export interface PlannedFileChange \{([\s\S]*?)\n\}/u.exec(
        persistenceTypes,
      )?.[1];
    expect(plannedFile).toBeDefined();
    expect(plannedFile).not.toContain("beforeText");
    expect(plannedFile).not.toContain("afterText");

    const mainSource = await readFile(
      join(repositoryRoot, "packages/obsidian-plugin/src/main.ts"),
      "utf8",
    );
    expect(mainSource).toContain("ObsidianMetadataLinkIndex");
    expect(mainSource).toContain("AutomaticMaintenance");
    expect(mainSource).not.toContain("SavedHeadingLinkSync");
  });

  it("packages the three release assets into a byte-stable valid ZIP", async () => {
    const firstResult = run(packageScript);
    expect(firstResult.status).toBe(0);
    const first = await readFile(artifact);
    expect(firstResult.stdout).toContain(`sha256=${sha256(first)}`);

    const secondResult = run(packageScript);
    expect(secondResult.status).toBe(0);
    const second = await readFile(artifact);

    expect(sha256(first)).toBe(sha256(second));
    expect(secondResult.stdout).toContain(`sha256=${sha256(second)}`);
    const entries = parseZipEntries(first);
    expect(entries.map((entry) => entry.name)).toEqual([
      "main.js",
      "manifest.json",
      "versions.json",
    ]);
    expect(entries.every((entry) => entry.mode === 0o100644)).toBe(true);
    expect(entries.every((entry) => entry.crc === crc32(entry.data))).toBe(
      true,
    );
    expect(run(wordJoinerScript).status).toBe(0);
    expect(run(sensitiveScript).status).toBe(0);
  });

  it("runs caller-supplied rejected-term checks and explicitly skips when absent", () => {
    const absent = run(releaseRejectedScript, [], {
      REJECTED_TERMS_JSON: undefined,
    });
    expect(absent.status).toBe(0);
    expect(absent.stdout).toContain("skipped");

    const detected = run(releaseRejectedScript, [], {
      REJECTED_TERMS_JSON: JSON.stringify(["heading-keeper"]),
    });
    expect(detected.status).toBe(1);
  });

  it("rejects the retired product identity in either a source path or content", async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), "heading-keeper-identity-"),
    );
    temporaryDirectories.push(fixtureRoot);
    execFileSync("git", ["init", "--quiet"], { cwd: fixtureRoot });

    const retiredSlug = ["heading", "numbering"].join("-");
    const retiredName = ["Heading", "Numbering"].join(" ");
    await mkdir(join(fixtureRoot, "docs"));
    await writeFile(
      join(fixtureRoot, "docs", `${retiredSlug}.md`),
      `# ${retiredName}\n`,
    );

    const rejected = run(identityScript, ["--root", fixtureRoot]);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("Retired product identity found");
    expect(rejected.stderr).toContain(`docs/${retiredSlug}.md: path`);
    expect(rejected.stderr).toContain(`docs/${retiredSlug}.md: content`);

    await rm(join(fixtureRoot, "docs"), { recursive: true });
    await writeFile(join(fixtureRoot, "README.md"), "# Heading Keeper\n");
    const accepted = run(identityScript, ["--root", fixtureRoot]);
    expect(accepted.status).toBe(0);
  });

  it("keeps the bundled release identity and runtime surface constrained", () => {
    execFileSync(
      "corepack",
      ["pnpm", "--filter", "@heading-keeper/obsidian-plugin", "build"],
      {
        cwd: repositoryRoot,
      },
    );
    const manifest = JSON.parse(
      execFileSync(
        "node",
        [
          "-e",
          "process.stdout.write(require('fs').readFileSync('packages/obsidian-plugin/manifest.json'))",
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
        },
      ),
    ) as { minAppVersion: string; version: string };
    const versions = JSON.parse(
      execFileSync(
        "node",
        [
          "-e",
          "process.stdout.write(require('fs').readFileSync('packages/obsidian-plugin/versions.json'))",
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
        },
      ),
    ) as Record<string, string>;
    const bundle = execFileSync(
      "node",
      [
        "-e",
        "process.stdout.write(require('fs').readFileSync('packages/obsidian-plugin/main.js'))",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );

    expect(versions[manifest.version]).toBe(manifest.minAppVersion);
    expect(bundle).not.toContain("sourceMappingURL");
    expect(bundle).toContain("file-open");
    expect(bundle).toContain("recovery-required");
    expect(bundle).not.toContain("SavedHeadingLinkSync");
    expect(bundle).not.toMatch(
      /require\(["'](?:node:)?(?:assert|buffer|child_process|crypto|fs|http|https|net|path|process|stream|url|util|worker_threads)["']\)|require\(["']electron["']\)|(?:fetch|XMLHttpRequest|WebSocket)\s*\(/iu,
    );
  });

  it("verifies byte-identical deployment assets while allowing data.json", async () => {
    execFileSync(
      "corepack",
      ["pnpm", "--filter", "@heading-keeper/obsidian-plugin", "build"],
      {
        cwd: repositoryRoot,
      },
    );
    const directory = await deploymentDirectory();
    await writeFile(join(directory, "data.json"), "{}");

    const result = run(verifyDeploymentScript, [directory]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("main.js sha256=");
    expect(result.stdout).toContain("manifest.json sha256=");
    expect(result.stdout).toContain("versions.json sha256=");
  });

  it("rejects incomplete, non-file, and every non-allowlisted deployment entry", async () => {
    execFileSync(
      "corepack",
      ["pnpm", "--filter", "@heading-keeper/obsidian-plugin", "build"],
      {
        cwd: repositoryRoot,
      },
    );
    const missing = await deploymentDirectory();
    await rm(join(missing, "main.js"));
    expect(run(verifyDeploymentScript, [missing]).status).toBe(1);

    const nonFile = await deploymentDirectory();
    await rm(join(nonFile, "main.js"));
    await mkdir(join(nonFile, "main.js"));
    expect(run(verifyDeploymentScript, [nonFile]).status).toBe(1);

    const unexpectedFiles: ReadonlyArray<readonly [string, string]> = [
      ["styles.css", "body {}"],
      ["unexpected.txt", "unexpected"],
      ["main.js.map", "{}"],
    ];
    for (const [name, content] of unexpectedFiles) {
      const extra = await deploymentDirectory();
      await writeFile(join(extra, name), content);
      expect(run(verifyDeploymentScript, [extra]).status).toBe(1);
    }

    for (const name of ["nested", "data.json"]) {
      const extraDirectory = await deploymentDirectory();
      await mkdir(join(extraDirectory, name));
      expect(run(verifyDeploymentScript, [extraDirectory]).status).toBe(1);
    }
  }, 15_000);

  it("rejects nonexistent and non-directory deployment paths", async () => {
    const missing = join(tmpdir(), "heading-keeper-deploy-does-not-exist");
    expect(run(verifyDeploymentScript, [missing]).status).toBe(1);

    const directory = await mkdtemp(join(tmpdir(), "heading-keeper-file-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "not-a-directory");
    await writeFile(file, "release target");
    expect(run(verifyDeploymentScript, [file]).status).toBe(1);
  });
});

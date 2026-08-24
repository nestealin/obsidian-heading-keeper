import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const sensitiveScript = join(repositoryRoot, "scripts/scan-sensitive.mjs");
const rejectedScript = join(repositoryRoot, "scripts/scan-rejected.mjs");
const sensitiveFixture = ["token", '"abcdefgh"'].join("=");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createGitFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "heading-numbering-scan-"));
  temporaryDirectories.push(directory);
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  return directory;
}

async function writeFixture(
  directory: string,
  name: string,
  content: string | Buffer,
): Promise<void> {
  const file = join(directory, name);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

function runScript(script: string, arguments_: string[], cwd: string) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd,
    encoding: "utf8",
  });
}

describe("source scan scripts", () => {
  it("skips a binary sensitive-pattern fixture", async () => {
    const directory = await createGitFixture();
    await writeFixture(
      directory,
      "fixture.bin",
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(sensitiveFixture)]),
    );

    expect(runScript(sensitiveScript, [], directory).status).toBe(0);
  });

  it("reports a sensitive pattern in text", async () => {
    const directory = await createGitFixture();
    await writeFixture(directory, "fixture.txt", sensitiveFixture);

    const result = runScript(sensitiveScript, [], directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fixture.txt");
  });

  it("skips a binary rejected-term fixture", async () => {
    const directory = await createGitFixture();
    await writeFixture(
      directory,
      "fixture.bin",
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from("blocked phrase")]),
    );

    expect(
      runScript(rejectedScript, ["--", "blocked phrase"], directory).status,
    ).toBe(0);
  });

  it("reports a rejected term in text", async () => {
    const directory = await createGitFixture();
    await writeFixture(directory, "fixture.txt", "blocked phrase");

    const result = runScript(rejectedScript, ["blocked phrase"], directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fixture.txt: blocked phrase");
  });

  it("ignores the first pnpm argument separator", async () => {
    const directory = await createGitFixture();
    await writeFixture(directory, "fixture.txt", "this text contains -- only");

    expect(
      runScript(rejectedScript, ["--", "absent phrase"], directory).status,
    ).toBe(0);
  });

  it("accepts a rejected term containing spaces", async () => {
    const directory = await createGitFixture();
    await writeFixture(directory, "fixture.txt", "a phrase with spaces");

    expect(
      runScript(rejectedScript, ["phrase with spaces"], directory).status,
    ).toBe(1);
  });

  it("exits with usage status when no rejected terms are supplied", async () => {
    const directory = await createGitFixture();

    expect(runScript(rejectedScript, [], directory).status).toBe(2);
  });

  it("surfaces a git failure", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "heading-numbering-scan-no-git-"),
    );
    temporaryDirectories.push(directory);

    const result = runScript(sensitiveScript, [], directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not a git repository");
  });
});

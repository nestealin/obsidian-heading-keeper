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
const publicSurfaceScript = join(
  repositoryRoot,
  "scripts/scan-public-surface.mjs",
);
const publicHistoryScript = join(
  repositoryRoot,
  "scripts/scan-public-history.mjs",
);
const rejectedScript = join(repositoryRoot, "scripts/scan-rejected.mjs");
const sensitiveFixture = ["token", '"abcdefgh"'].join("=");
const wordJoinerScript = join(repositoryRoot, "scripts/scan-word-joiner.mjs");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createGitFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "heading-keeper-scan-"));
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

function commitFixture(directory: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd: directory });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.com",
      "commit",
      "--quiet",
      "-m",
      message,
    ],
    { cwd: directory },
  );
}

function runScript(
  script: string,
  arguments_: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

describe("source scan scripts", () => {
  it("rejects internal planning paths from the public surface", async () => {
    const directory = await createGitFixture();
    await writeFixture(
      directory,
      "docs/superpowers/plans/internal.md",
      "internal plan",
    );

    const result = runScript(publicSurfaceScript, [], directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/superpowers/plans/internal.md");
    expect(result.stderr).not.toContain("internal plan");
  });

  it("rejects local machine paths without printing their contents", async () => {
    const directory = await createGitFixture();
    const localPath = ["/", "Users/example/private-note.md"].join("");
    await writeFixture(directory, "fixture.txt", localPath);

    const result = runScript(publicSurfaceScript, [], directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fixture.txt");
    expect(result.stderr).not.toContain(localPath);
  });

  it("rejects private vault identity from the public surface", async () => {
    const directory = await createGitFixture();
    await writeFixture(directory, "fixture.txt", ["Nes", "Vault"].join(""));

    const result = runScript(publicSurfaceScript, [], directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fixture.txt");
  });

  it("rejects private test-vault identity from the public surface", async () => {
    const directory = await createGitFixture();
    await writeFixture(directory, "fixture.txt", ["Nes", "Dev"].join(""));

    const result = runScript(publicSurfaceScript, [], directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fixture.txt");
  });

  it("allows the public repository author identity", async () => {
    const directory = await createGitFixture();
    await writeFixture(directory, "manifest.json", '{"author":"nestealin"}');

    expect(runScript(publicSurfaceScript, [], directory).status).toBe(0);
  });

  it("rejects an internal file deleted from the current tree but retained in HEAD history", async () => {
    const directory = await createGitFixture();
    const path = "docs/superpowers/plans/internal.md";
    await writeFixture(directory, path, "internal plan");
    commitFixture(directory, "add internal plan");
    await rm(join(directory, path));
    commitFixture(directory, "remove internal plan");

    expect(runScript(publicSurfaceScript, [], directory).status).toBe(0);
    const result = runScript(publicHistoryScript, [], directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(path);
    expect(result.stderr).not.toContain("internal plan");
  });

  it("accepts a clean reachable history", async () => {
    const directory = await createGitFixture();
    await writeFixture(directory, "README.md", "public documentation");
    commitFixture(directory, "add public documentation");

    expect(runScript(publicHistoryScript, [], directory).status).toBe(0);
  });

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

  it("accepts rejected terms from the JSON environment array", async () => {
    const directory = await createGitFixture();
    await writeFixture(directory, "fixture.txt", "environment supplied phrase");

    expect(
      runScript(rejectedScript, [], directory, {
        REJECTED_TERMS_JSON: JSON.stringify(["environment supplied phrase"]),
      }).status,
    ).toBe(1);
  });

  it("rejects an invalid rejected-terms JSON environment", async () => {
    const directory = await createGitFixture();

    expect(
      runScript(rejectedScript, [], directory, {
        REJECTED_TERMS_JSON: "not-json",
      }).status,
    ).toBe(2);
  });

  it("exits with usage status when no rejected terms are supplied", async () => {
    const directory = await createGitFixture();

    expect(runScript(rejectedScript, [], directory).status).toBe(2);
  });

  it("surfaces a git failure", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "heading-keeper-scan-no-git-"),
    );
    temporaryDirectories.push(directory);

    const result = runScript(sensitiveScript, [], directory);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not a git repository");
  });

  it("reports a word joiner in a text fixture", async () => {
    const directory = await createGitFixture();
    await writeFixture(
      directory,
      "fixture.txt",
      `a${String.fromCodePoint(0x2060)}b`,
    );

    const result = runScript(wordJoinerScript, [], directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fixture.txt");
  });

  it("skips a binary word-joiner fixture", async () => {
    const directory = await createGitFixture();
    await writeFixture(
      directory,
      "fixture.bin",
      Buffer.concat([
        Buffer.from([0, 1, 2]),
        Buffer.from(String.fromCodePoint(0x2060)),
      ]),
    );

    expect(runScript(wordJoinerScript, [], directory).status).toBe(0);
  });
});

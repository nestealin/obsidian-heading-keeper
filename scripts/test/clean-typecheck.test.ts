import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

async function copyTrackedCheckout(): Promise<string> {
  const checkout = await mkdtemp(
    join(tmpdir(), "heading-keeper-clean-typecheck-"),
  );
  temporaryDirectories.push(checkout);

  const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter((path) => path.length > 0);

  for (const path of trackedPaths) {
    const target = join(checkout, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(repositoryRoot, path), target);
  }

  return checkout;
}

describe("clean workspace gate", () => {
  it("typechecks without pre-existing package dist outputs", async () => {
    const checkout = await copyTrackedCheckout();
    const install = spawnSync(
      "corepack",
      ["pnpm", "install", "--offline", "--frozen-lockfile"],
      {
        cwd: checkout,
        encoding: "utf8",
      },
    );
    expect(install.status, `${install.stdout}\n${install.stderr}`).toBe(0);

    const typecheck = spawnSync("corepack", ["pnpm", "typecheck"], {
      cwd: checkout,
      encoding: "utf8",
    });
    expect(typecheck.status, `${typecheck.stdout}\n${typecheck.stderr}`).toBe(
      0,
    );
  }, 30_000);
});

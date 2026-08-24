import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.REJECTED_TERMS_JSON) {
  process.stdout.write(
    "Rejected-term release scan skipped: no caller terms supplied.\n",
  );
  process.exit(0);
}

const result = spawnSync(process.execPath, ["scripts/scan-rejected.mjs"], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

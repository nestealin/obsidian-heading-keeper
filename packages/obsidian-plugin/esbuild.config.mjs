import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginDirectory = dirname(fileURLToPath(import.meta.url));
const pluginBundle = join(pluginDirectory, "main.js");
const communityBundle = join(pluginDirectory, "../..", "main.js");

await build({
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["obsidian", "@codemirror/state", "@codemirror/view"],
  format: "cjs",
  outfile: pluginBundle,
  platform: "node",
  sourcemap: false,
  target: "es2022",
});

await copyFile(pluginBundle, communityBundle);

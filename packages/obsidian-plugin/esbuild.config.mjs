import { build } from "esbuild";

await build({
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["obsidian", "@codemirror/state", "@codemirror/view"],
  format: "cjs",
  outfile: "main.js",
  platform: "node",
  sourcemap: false,
  target: "es2022",
});

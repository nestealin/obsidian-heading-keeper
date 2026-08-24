import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(
        new URL(
          "./packages/obsidian-plugin/test/obsidian-stub.ts",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "scripts/test/**/*.test.ts"],
  },
});

import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

describe("production bundle surface", () => {
  it("exports the plugin constructor as the CommonJS default", async () => {
    class Plugin {}
    const module = { exports: {} as Record<string, unknown> };
    const bundle = await readFile(
      new URL("../main.js", import.meta.url),
      "utf8",
    );
    const obsidian = {
      MarkdownRenderChild: class {},
      Notice: class {},
      Plugin,
      PluginSettingTab: class {},
      Setting: class {},
    };

    runInNewContext(bundle, {
      exports: module.exports,
      module,
      require: (identifier: string) => {
        if (identifier === "obsidian") {
          return obsidian;
        }
        throw new Error(`Unexpected bundle dependency: ${identifier}`);
      },
    });

    expect(module.exports.default).toBe(module.exports.HeadingNumberingPlugin);
    expect(
      Object.getPrototypeOf(
        (module.exports.default as { prototype: object }).prototype,
      ),
    ).toBe(Plugin.prototype);
  });
});

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
      Modal: class {},
      Notice: class {},
      Plugin,
      PluginSettingTab: class {},
      Setting: class {},
      TFile: class {},
    };
    const state = {
      StateEffect: {
        define: () => ({
          is: () => false,
          of: (value: unknown) => value,
        }),
      },
    };
    const view = {
      Decoration: {
        set: () => ({}),
        widget: () => ({ range: () => ({}) }),
      },
      EditorView: class {},
      ViewPlugin: { fromClass: () => ({}) },
      WidgetType: class {},
    };

    expect(bundle).toContain('require("@codemirror/state")');
    expect(bundle).toContain('require("@codemirror/view")');
    expect(bundle).not.toContain(
      "Unrecognized extension value in extension set",
    );
    expect(bundle).toContain("file-open");
    expect(bundle).toContain("recovery-required");

    runInNewContext(bundle, {
      activeWindow: {
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        crypto: globalThis.crypto,
        navigator: {},
        setTimeout: globalThis.setTimeout.bind(globalThis),
      },
      exports: module.exports,
      module,
      require: (identifier: string) => {
        if (identifier === "obsidian") {
          return obsidian;
        }
        if (identifier === "@codemirror/state") {
          return state;
        }
        if (identifier === "@codemirror/view") {
          return view;
        }
        throw new Error(`Unexpected bundle dependency: ${identifier}`);
      },
    });

    expect(module.exports.default).toBe(module.exports.HeadingKeeperPlugin);
    expect(
      Object.getPrototypeOf(
        (module.exports.default as { prototype: object }).prototype,
      ),
    ).toBe(Plugin.prototype);
  });
});

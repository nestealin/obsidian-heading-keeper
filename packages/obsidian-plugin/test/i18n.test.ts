import { describe, expect, it } from "vitest";
import { resolveLocale, translate } from "../src/i18n.js";

describe("plugin translations", () => {
  it("uses the requested language or resolves Auto from the system locale", () => {
    expect(resolveLocale("auto", "zh-CN")).toBe("zh");
    expect(resolveLocale("auto", "en-US")).toBe("en");
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(resolveLocale("zh", "en-US")).toBe("zh");
  });

  it("provides visible Auto, English, and Chinese labels", () => {
    expect(translate("en", "locale.auto")).toBe("Auto");
    expect(translate("en", "locale.en")).toBe("English");
    expect(translate("zh", "locale.zh")).toBe("中文");
    expect(translate("en", "notices.refresh")).toBe(
      "Virtual numbering refreshed.",
    );
    expect(translate("zh", "notices.refresh")).toBe("虚拟编号已刷新。");
  });
});

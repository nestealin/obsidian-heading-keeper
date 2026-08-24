export type Locale = "en" | "zh";
export type LocalePreference = "auto" | Locale;

export type TranslationKey =
  | "locale.auto"
  | "locale.en"
  | "locale.zh"
  | "settings.heading"
  | "settings.locale"
  | "settings.localeDescription"
  | "settings.persistenceBoundary"
  | "settings.errors"
  | "commands.preview"
  | "commands.apply"
  | "commands.remove"
  | "commands.refresh"
  | "commands.openSettings"
  | "notices.preview"
  | "notices.apply"
  | "notices.remove"
  | "notices.refresh"
  | "notices.openSettings";

const translations: Record<Locale, Record<TranslationKey, string>> = {
  en: {
    "locale.auto": "Auto",
    "locale.en": "English",
    "locale.zh": "中文",
    "settings.heading": "Heading Numbering",
    "settings.locale": "Language",
    "settings.localeDescription": "Choose the language used by this plugin.",
    "settings.persistenceBoundary":
      "Virtual numbering is the default. File changes require an explicit preview and apply step.",
    "settings.errors": "Saved settings need attention.",
    "commands.preview": "Preview persisted numbering",
    "commands.apply": "Apply persisted numbering",
    "commands.remove": "Remove persisted numbering",
    "commands.refresh": "Refresh virtual numbering",
    "commands.openSettings": "Open Heading Numbering settings",
    "notices.preview": "Persisted preview will be available in a later step.",
    "notices.apply":
      "Persisted apply will be available after an explicit preview.",
    "notices.remove": "Persisted removal will be available after confirmation.",
    "notices.refresh": "Virtual numbering refresh is not available yet.",
    "notices.openSettings":
      "Open Obsidian Settings to configure Heading Numbering.",
  },
  zh: {
    "locale.auto": "自动",
    "locale.en": "English",
    "locale.zh": "中文",
    "settings.heading": "标题编号",
    "settings.locale": "语言",
    "settings.localeDescription": "选择此插件使用的语言。",
    "settings.persistenceBoundary":
      "默认只显示虚拟编号。修改文件需要明确的预览和执行步骤。",
    "settings.errors": "已保存的设置需要处理。",
    "commands.preview": "预览写入编号",
    "commands.apply": "写入编号",
    "commands.remove": "移除已写入编号",
    "commands.refresh": "刷新虚拟编号",
    "commands.openSettings": "打开标题编号设置",
    "notices.preview": "写入预览将在后续步骤提供。",
    "notices.apply": "写入操作需要先完成明确预览。",
    "notices.remove": "移除操作需要确认后才会提供。",
    "notices.refresh": "虚拟编号刷新尚未提供。",
    "notices.openSettings": "请在 Obsidian 设置中配置标题编号。",
  },
};

export function resolveLocale(
  preference: LocalePreference,
  systemLocale: string,
): Locale {
  if (preference !== "auto") {
    return preference;
  }
  return systemLocale.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function translate(locale: Locale, key: TranslationKey): string {
  return translations[locale][key];
}

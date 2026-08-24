export type Locale = "en" | "zh";
export type LocalePreference = "auto" | Locale;

export type TranslationKey =
  | "locale.auto"
  | "locale.en"
  | "locale.zh"
  | "settings.heading"
  | "settings.mode"
  | "settings.modeDescription"
  | "settings.topLevel"
  | "settings.topLevelDescription"
  | "settings.bottomLevel"
  | "settings.bottomLevelDescription"
  | "settings.startAt"
  | "settings.startAtDescription"
  | "settings.numberSeparator"
  | "settings.numberSeparatorDescription"
  | "settings.titleSeparator"
  | "settings.titleSeparatorDescription"
  | "settings.gapStrategy"
  | "settings.gapStrategyDescription"
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
  | "notices.openSettings"
  | "mode.virtual"
  | "mode.persisted"
  | "gapStrategy.zeroFill"
  | "gapStrategy.oneFill"
  | "gapStrategy.compact"
  | "gapStrategy.skip";

const translations: Record<Locale, Record<TranslationKey, string>> = {
  en: {
    "locale.auto": "Auto",
    "locale.en": "English",
    "locale.zh": "中文",
    "settings.heading": "Heading Numbering",
    "settings.mode": "Numbering mode",
    "settings.modeDescription":
      "Persisted mode only enables explicit preview, apply, and remove actions. It never writes in the background.",
    "settings.topLevel": "Top heading level",
    "settings.topLevelDescription":
      "First heading level included in numbering (1 through 6).",
    "settings.bottomLevel": "Bottom heading level",
    "settings.bottomLevelDescription":
      "Last heading level included in numbering (1 through 6).",
    "settings.startAt": "Start at",
    "settings.startAtDescription":
      "Non-negative number used for the first heading.",
    "settings.numberSeparator": "Number separator",
    "settings.numberSeparatorDescription": "Text between each number segment.",
    "settings.titleSeparator": "Title separator",
    "settings.titleSeparatorDescription":
      "Text between the number prefix and title.",
    "settings.gapStrategy": "Gap strategy",
    "settings.gapStrategyDescription":
      "How skipped heading levels are displayed.",
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
    "mode.virtual": "Virtual",
    "mode.persisted": "Persisted",
    "gapStrategy.zeroFill": "Zero fill",
    "gapStrategy.oneFill": "One fill",
    "gapStrategy.compact": "Compact",
    "gapStrategy.skip": "Skip",
  },
  zh: {
    "locale.auto": "自动",
    "locale.en": "English",
    "locale.zh": "中文",
    "settings.heading": "标题编号",
    "settings.mode": "编号模式",
    "settings.modeDescription":
      "写入模式只启用明确的预览、写入和移除操作，绝不会在后台写入。",
    "settings.topLevel": "起始标题层级",
    "settings.topLevelDescription": "参与编号的第一个标题层级（1 到 6）。",
    "settings.bottomLevel": "结束标题层级",
    "settings.bottomLevelDescription": "参与编号的最后一个标题层级（1 到 6）。",
    "settings.startAt": "起始编号",
    "settings.startAtDescription": "第一个标题使用的非负编号。",
    "settings.numberSeparator": "数字分隔符",
    "settings.numberSeparatorDescription": "各数字层级之间的文本。",
    "settings.titleSeparator": "标题分隔符",
    "settings.titleSeparatorDescription": "编号前缀与标题之间的文本。",
    "settings.gapStrategy": "断层策略",
    "settings.gapStrategyDescription": "跳过标题层级时的显示方式。",
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
    "mode.virtual": "虚拟",
    "mode.persisted": "写入",
    "gapStrategy.zeroFill": "补零",
    "gapStrategy.oneFill": "补一",
    "gapStrategy.compact": "紧凑",
    "gapStrategy.skip": "跳过",
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

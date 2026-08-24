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
  | "notices.refresh"
  | "notices.openSettings"
  | "notices.persistedModeRequired"
  | "notices.activeMarkdownRequired"
  | "notices.previewReady"
  | "notices.previewNoChanges"
  | "notices.previewRequired"
  | "notices.previewInvalidated"
  | "notices.applyCompleted"
  | "notices.applyStale"
  | "notices.applyRecovery"
  | "notices.operationError"
  | "notices.storageError"
  | "notices.settingsSaving"
  | "notices.recoveryAvailable"
  | "notices.recoveryNone"
  | "notices.restoreCompleted"
  | "modal.preview.aria"
  | "modal.preview.target"
  | "modal.preview.links"
  | "modal.preview.preserved"
  | "modal.preview.skips"
  | "modal.preview.boundary"
  | "modal.preview.confirm"
  | "modal.preview.action.add"
  | "modal.preview.action.remove"
  | "modal.preview.empty"
  | "modal.preview.boundary.sourceHashPreflight"
  | "modal.preview.boundary.externalChangePreserved"
  | "modal.recovery.aria"
  | "modal.recovery.heading"
  | "modal.recovery.restore"
  | "modal.recovery.finalize"
  | "recovery.status.eligible"
  | "recovery.status.changed"
  | "recovery.status.restored"
  | "recovery.status.pending"
  | "settings.recovery"
  | "settings.recoveryDescription"
  | "settings.openRecovery"
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
    "notices.refresh": "Virtual numbering refreshed.",
    "notices.openSettings":
      "Open Obsidian Settings to configure Heading Numbering.",
    "notices.persistedModeRequired": "Switch to persisted mode first.",
    "notices.activeMarkdownRequired": "Open an active Markdown file first.",
    "notices.previewReady": "Persisted preview is ready for confirmation.",
    "notices.previewNoChanges": "No safe persisted changes were found.",
    "notices.previewRequired": "Create a persisted preview first.",
    "notices.previewInvalidated": "The persisted preview is no longer current.",
    "notices.applyCompleted": "Persisted changes completed.",
    "notices.applyStale": "Preview is stale; no files were changed.",
    "notices.applyRecovery":
      "Writing stopped. Open recovery before continuing.",
    "notices.operationError": "The persisted operation could not be completed.",
    "notices.storageError": "Plugin data could not be saved.",
    "notices.settingsSaving": "Settings are still being saved.",
    "notices.recoveryAvailable": "A persisted operation requires recovery.",
    "notices.recoveryNone": "No persisted operation requires recovery.",
    "notices.restoreCompleted": "Eligible files were restored.",
    "modal.preview.aria": "Persisted numbering preview",
    "modal.preview.target": "Target heading edits",
    "modal.preview.links": "Link edits",
    "modal.preview.preserved": "Preserved items",
    "modal.preview.skips": "Skipped headings",
    "modal.preview.boundary": "Recovery boundary",
    "modal.preview.confirm": "Confirm current preview",
    "modal.preview.action.add": "Add persisted numbering",
    "modal.preview.action.remove": "Remove persisted numbering",
    "modal.preview.empty": "(empty)",
    "modal.preview.boundary.sourceHashPreflight":
      "All source hashes are checked before the first write.",
    "modal.preview.boundary.externalChangePreserved":
      "Externally changed files are preserved during recovery.",
    "modal.recovery.aria": "Persisted operation recovery center",
    "modal.recovery.heading": "Recovery status",
    "modal.recovery.restore": "Restore eligible files",
    "modal.recovery.finalize": "Complete recovery",
    "recovery.status.eligible": "eligible",
    "recovery.status.changed": "changed",
    "recovery.status.restored": "restored",
    "recovery.status.pending": "pending",
    "settings.recovery": "Recovery center",
    "settings.recoveryDescription":
      "Inspect and safely restore an interrupted persisted operation.",
    "settings.openRecovery": "Open recovery",
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
    "notices.refresh": "虚拟编号已刷新。",
    "notices.openSettings": "请在 Obsidian 设置中配置标题编号。",
    "notices.persistedModeRequired": "请先切换到写入模式。",
    "notices.activeMarkdownRequired": "请先打开一个 Markdown 文件。",
    "notices.previewReady": "写入预览已生成，等待明确确认。",
    "notices.previewNoChanges": "没有发现可安全执行的写入变更。",
    "notices.previewRequired": "请先生成写入预览。",
    "notices.previewInvalidated": "当前写入预览已失效。",
    "notices.applyCompleted": "写入变更已完成。",
    "notices.applyStale": "预览已过期，未修改任何文件。",
    "notices.applyRecovery": "写入已停止，请先打开恢复中心。",
    "notices.operationError": "无法完成写入事务。",
    "notices.storageError": "无法保存插件数据。",
    "notices.settingsSaving": "设置仍在保存中。",
    "notices.recoveryAvailable": "存在需要恢复的写入事务。",
    "notices.recoveryNone": "当前没有需要恢复的写入事务。",
    "notices.restoreCompleted": "可恢复文件已还原。",
    "modal.preview.aria": "标题编号写入预览",
    "modal.preview.target": "目标标题编辑",
    "modal.preview.links": "链接编辑",
    "modal.preview.preserved": "保留项",
    "modal.preview.skips": "跳过的标题",
    "modal.preview.boundary": "恢复边界",
    "modal.preview.confirm": "确认当前预览",
    "modal.preview.action.add": "写入标题编号",
    "modal.preview.action.remove": "移除写入编号",
    "modal.preview.empty": "（空）",
    "modal.preview.boundary.sourceHashPreflight":
      "首次写入前会校验所有来源哈希。",
    "modal.preview.boundary.externalChangePreserved":
      "恢复时会保留经过外部修改的文件。",
    "modal.recovery.aria": "写入事务恢复中心",
    "modal.recovery.heading": "恢复状态",
    "modal.recovery.restore": "恢复可还原文件",
    "modal.recovery.finalize": "完成恢复",
    "recovery.status.eligible": "可恢复",
    "recovery.status.changed": "已外部修改",
    "recovery.status.restored": "已恢复",
    "recovery.status.pending": "待处理",
    "settings.recovery": "恢复中心",
    "settings.recoveryDescription": "检查并安全恢复中断的写入事务。",
    "settings.openRecovery": "打开恢复中心",
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

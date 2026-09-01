# Heading Keeper

English | [简体中文](README.zh-CN.md)

Automatic heading numbers that keep links alive.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="assets/readme/heading-keeper-demo-poster.png">
  <img src="assets/readme/heading-keeper-demo.gif" alt="Heading Keeper silently renumbers an Obsidian outline, updates a linked note after a heading rename, and opens the repaired link." width="960">
</picture>

**Virtual by default · Persisted integrity by opt-in · Local and offline**

Virtual mode never changes Markdown. The animation shows persisted mode after
its one-time opt-in: numbering and unambiguous heading links stay synchronized
without manual saves or routine confirmation dialogs.

Heading Keeper is a public community plugin for Obsidian, built for local and
offline use.

[Install](#installation) · [Download the latest release](https://github.com/nestealin/obsidian-heading-keeper/releases/latest)

## Why Heading Keeper

- Insert, remove, or move a heading and its hierarchy is silently renumbered.
- Rename a uniquely referenced heading and Wiki or Markdown links follow it.
- Audit older broken links separately, with an explicit review before repair.
- Keep all processing local: no network requests and no telemetry.

## Numbering modes

### Virtual mode

Virtual mode is enabled by default. It renders numbers in the editor and reading
view and performs no Vault writes.

### Persisted mode

Persisted mode requires an explicit one-time opt-in. Heading Keeper then
maintains the currently opened Markdown note after Obsidian saves it. Routine
maintenance is silent and does not require a preview, a manual save, or another
confirmation.

Numbering is not applied to unopened notes in the background. A note is
reconciled when it is opened. Disable other plugins that write heading numbers
before enabling persisted mode.

## Heading-link maintenance

Heading Keeper builds a lightweight reverse index from Obsidian's metadata
cache. When a heading rename is uniquely identifiable, it updates only the
indexed source notes that link to that heading. The heading change and its link
updates share one durable, retryable operation.

Historical broken or ambiguous links remain read-only until the user runs
**Audit heading links**, chooses exact targets, reviews the repair plan, and
confirms it. The audit is the only normal feature that reads every Markdown
body.

## Safety and privacy

- Heading Keeper works locally and offline. It sends no network requests,
  collects no telemetry, and does not access files outside the Vault.
- Each write verifies the current file version and uses minimal edits through
  Obsidian's Vault API.
- Interrupted work is retained for retry and restart recovery. Completed edit
  text is discarded immediately.
- Plugin data does not contain full-note snapshots. It retains at most 50
  text-free summaries for seven days, with pending work and summaries capped at
  1 MiB combined.
- Pending recovery data is stored in
  `<vault>/.obsidian/plugins/heading-keeper/data.json`. It contains hashes and
  minimal changed fragments, not full note bodies. Disable the plugin and
  delete this file to clear its local state.
- A full-vault heading-link audit reads Markdown bodies only in memory after an
  explicit command; audit text is neither persisted nor transmitted.
- Stale, conflicting, or ambiguous changes are preserved for review instead of
  being guessed or overwritten.

## Installation

### Community plugins

Find **Heading Keeper** in **Settings → Community plugins → Browse**. If the
listing is still under review, use the GitHub release method below.

### GitHub release

Before the Community listing is available, download the release assets from the
latest GitHub release and place `main.js` and `manifest.json` in:

```text
<vault>/.obsidian/plugins/heading-keeper/
```

Reload Obsidian, enable **Heading Keeper**, and keep virtual mode enabled while
checking the configured heading levels and number format. Persisted mode can
then be enabled explicitly in the plugin settings.

## Commands

- **Preview current reconciliation** shows the current note's planned changes.
- **Reconcile current note now** runs maintenance for the active note.
- **Remove managed numbering** removes only numbering owned by Heading Keeper.
- **Refresh virtual numbering** refreshes the rendered numbers.
- **Audit heading links** finds and guides repair of existing heading-link
  problems.
- **Open Heading Keeper settings** opens the plugin settings.

## Compatibility

- Requires Obsidian `1.12.7` or later.
- Desktop behavior is verified for virtual rendering, persisted maintenance,
  restart recovery, and heading-link synchronization.
- The plugin uses mobile-compatible Obsidian APIs and declares mobile support;
  real-device mobile validation is still in progress for version `0.2.1`.

## Development

Use Node `22.20.0` and pnpm `11.15.0`:

```bash
corepack pnpm install
corepack pnpm verify:local
corepack pnpm verify:release
```

The workspace keeps Markdown parsing and numbering logic in
`@heading-keeper/core`, independent of Obsidian, CodeMirror, DOM, and Vault
APIs.

## License

Heading Keeper is available under the [MIT License](LICENSE).

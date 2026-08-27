# Heading Keeper

An offline Obsidian plugin that keeps hierarchical heading numbers and
heading-fragment links coherent.

- Virtual numbering is enabled by default and never writes Markdown.
- Persisted numbering is a one-time opt-in. After that, opened and edited notes
  are maintained silently after Obsidian saves them.
- Uniquely proven heading renames update only reverse-indexed link sources.
  Numbering and link changes share one durable, retryable operation.
- Historical broken links remain read-only until the user chooses an exact
  target and confirms the complete repair selection.

Version `0.2.0` remains a private-test build and starts in virtual mode. It is
intended to become a generally installable community plugin; local Vault habits
are acceptance inputs, not product-wide feature rules.

## Runtime behavior

Virtual mode computes numbers in the editor and reading view and performs zero
Vault writes. Persisted mode listens to file-open, save/modify, and metadata
events, coalesces rapid changes, then compares and updates only the current note
and metadata-indexed link sources. It does not build or persist a full-text
Vault snapshot.

Each write stores hashes and minimal forward/reverse edits, verifies the file
again inside Obsidian's `Vault.process`, and keeps unfinished work for restart
recovery. Completed edit text is discarded immediately. At most 50 text-free
summaries are retained for seven days, and all pending plus summary data is
capped at 1 MiB.

Routine automatic work opens no confirmation dialog and shows no success
notice. Manual preview remains a diagnostic command. The explicit Vault-wide
audit is the only normal feature that reads every Markdown body; filtering,
navigation, and JSON export do not write notes. Historical repair writes only
the exact user-selected plan and refuses stale or ambiguous selections.

## Development

Use Node `22.20.0` and pnpm `11.15.0`:

```bash
corepack pnpm install
corepack pnpm verify:local
```

The workspace keeps Markdown parsing and numbering logic in
`@heading-keeper/core`, independent of Obsidian and browser APIs.

## Readiness

Version `0.2.0` has automated coverage for silent persisted maintenance,
per-file concurrency protection, restart recovery, bounded plugin data,
incremental reverse-link indexing, and guided repair. It is not yet approved as
the sole heading writer in the main Vault; replacement requires the isolated
isolated test Vault acceptance run documented in this repository. A batch whole-Vault
numbering migration is not a replacement prerequisite.

## Internal-test installation

Build the three release assets:

```bash
corepack pnpm build
corepack pnpm package:plugin
```

Copy `main.js`, `manifest.json`, and `versions.json` from
`packages/obsidian-plugin/` into
`<vault>/.obsidian/plugins/heading-keeper/`. Enable only Heading Keeper as a
heading writer, keep `mode: virtual`, reload Obsidian, and verify rendering and
the read-only link audit before opting into persisted mode. To roll back,
disable Heading Keeper and restore the previous plugin enablement and Vault
snapshot.

After copying, verify the installed bytes:

```bash
corepack pnpm verify:deployment <vault>/.obsidian/plugins/heading-keeper
```

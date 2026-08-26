# Heading Keeper

An offline Obsidian plugin that keeps hierarchical heading numbers and
heading-fragment links coherent.

- Virtual numbering is enabled by default and never writes Markdown.
- Persisted numbering requires an explicit preview and confirmation.
- Direct saved title renames update resolved heading links only when the
  old-to-new identity is uniquely provable; ambiguous changes are preserved.
- The heading-link audit discovers historical missing or duplicate fragments
  without changing any file.

Version `0.1.0` starts in virtual mode: it renders numbers without modifying
notes. Persisted numbering is available only through explicit preview and
apply commands.

## Development

Use Node `22.20.0` and pnpm `11.15.0`:

```bash
corepack pnpm install
corepack pnpm verify:local
```

The workspace keeps Markdown parsing and numbering logic in
`@heading-keeper/core`, independent of Obsidian and browser APIs.

## Readiness

Version `0.1.0` is an internal-test build. It is suitable for isolated Vault
observation, but it is not yet approved as the sole heading writer for a large
existing Vault. Formal replacement still requires durable rename retries,
bounded recovery data, incremental link indexing, guided broken-link repair,
and a Vault-wide persisted-numbering migration workflow.

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
the read-only link audit before any explicit persisted operation. To roll back,
disable Heading Keeper and restore the previous plugin enablement and Vault
snapshot.

After copying, verify the installed bytes:

```bash
corepack pnpm verify:deployment <vault>/.obsidian/plugins/heading-keeper
```

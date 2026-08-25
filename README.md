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

# Heading Numbering

An offline Obsidian plugin for configurable hierarchical heading numbers.

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
`@heading-numbering/core`, independent of Obsidian and browser APIs.

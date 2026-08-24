# Heading Numbering engineering rules

- Keep the plugin local-only and offline at runtime.
- Keep virtual numbering as the default; persistence requires an explicit user action.
- Keep `packages/core` independent of Obsidian, CodeMirror, DOM, and vault APIs.
- Use test-first development for behavior changes and run the workspace checks before committing.
- Do not commit secrets, generated distributions, or local worktree state.

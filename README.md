# What TODO

VS Code extension that sniffs to-dos out of code comments, lists them, jumps to them and lets you check them off.

## Features

- **Finds** `todo`, `TODO`, `to do`, `TO DO`, `to-do`, `TO-DO` (any case) at the start of a comment
  (`// TODO: x`, `# todo x`, ` * @todo x`, `{/* TO-DO x */}`, `<!-- TODO x -->`).
  Text inside strings (`"http://todo.com"`) and prose like `// nothing to do here` are ignored.
- **Languages:** PHP, JS, TS, JSX, TSX (plus mjs/cjs/mts/cts, Vue, Svelte, Astro, C-family, Go, Rust,
  Java, Kotlin, Swift, C#, CSS/SCSS/Less, Python, Ruby, shell, YAML, TOML, HTML, XML, SQL).
  PHP is lexed properly: `//`, `#` (but not `#[Attributes]`), `/* */`, and `<!-- -->` outside `<?php ?>`.
- **List:** the *What TODO* activity bar view shows every to-do grouped by file (or flat), with an open-count badge.
  `What TODO: List All To-dos` opens a searchable quick pick.
- **Go to:** click a to-do to open the file with the to-do selected.
- **Check off:** tick the checkbox (or the ✓ button). This rewrites the keyword to `DONE` in the source, so the state
  lives in your code and in git. Unticking turns it back into `TODO`. Only upper-case `DONE` counts as checked off.
- **Remove:** right-click → *Remove Comment* deletes the comment (after a confirmation).
- Live updates while typing, on save, and when files are created or deleted. Filter and show/hide-done toggles in the view title.

## Settings

| Setting | Default | |
|---|---|---|
| `whatTodo.excludeFolders` | `node_modules`, `vendor`, `dist`, `out`, `build`, ... | Folders never scanned |
| `whatTodo.maxFileSizeKB` | `1024` | Skip bigger files |
| `whatTodo.showDone` | `true` | Show checked-off items |
| `whatTodo.groupByFile` | `true` | Tree vs flat list |
| `whatTodo.saveAfterCheckOff` | `true` | Save after editing (only if the file had no unsaved changes) |

## Development

Requires Node 26 (`nvm use`).

```sh
npm install
npm run build     # compile TypeScript to out/
npm test          # build + scanner unit tests (node:test)
npm run package   # test + produce what-todo-<version>.vsix
code --install-extension what-todo-0.1.0.vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

# Project Copy

Project Copy is a VS Code extension for copying what you pick in the Explorer to the clipboard. It stays simple: ignore the files you do not want, keep the content as-is, and copy it in plaintext, Markdown, or XML.

## Features

- Context-aware Explorer actions
- Structure-only copy action for folders
- Root actions available from the File Explorer title menu
- Root copy available from the Command Palette and keyboard shortcut
- Respects the workspace-root `.gitignore` when enabled
- One custom ignore list for project-level filtering, including dotfiles by default
- Optional project tree in workspace and folder output
- Optional content-only exclusions for files you want listed but not pasted
- Binary, encoding, and large-file safeguards

## How To Use

In the Explorer, right-click:

- A folder: choose `Copy Folder Contents`, `Copy Folder Structure`, or `Exclude Content from Copy`
- A file: choose `Copy File Contents` or `Exclude Content from Copy`
- Multiple selected items in the same workspace folder: choose `Copy Selected Items` or `Exclude Content from Copy`

Blank Explorer space is not used as a Project Copy action surface.

Use the File Explorer title menu for the workspace root:

- `Copy Workspace Contents`
- `Copy Workspace Structure`
- `Exclude Workspace Content from Copy`

Use the Command Palette or the keyboard shortcut for the workspace-root `Copy Workspace Contents` action.

After copying, the notification tells you what was copied.

`Copy File Contents` and `Copy Selected Items` stay focused on the selected content and do not prepend the workspace tree, even when `projectCopy.includeProjectTree` is enabled.

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| `projectCopy.ignoreGitIgnore` | Skip files and folders matched by your root `.gitignore`. | `true` |
| `projectCopy.ignorePatterns` | Skip files and folders that match these patterns. | `[".*", "node_modules", "out", "out/**", "dist", "dist/**", "coverage", "coverage/**", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "*.log"]` |
| `projectCopy.maxDepth` | Only limits the tree preview. Deep files still get copied. | `5` |
| `projectCopy.outputFormat` | Choose the copy format. | `"markdown"` |
| `projectCopy.maxFileSize` | If a file is bigger than this, show a size note instead of its contents. | `1048576` |
| `projectCopy.includeProjectTree` | Add the folder tree before the copied files. | `true` |
| `projectCopy.excludeContentPatterns` | Keep matching files in the tree, but hide their contents. | `[]` |

Example `.vscode/settings.json`:

```json
{
  "projectCopy.ignoreGitIgnore": true,
  "projectCopy.ignorePatterns": [
    ".*",
    "node_modules",
    "out",
    "out/**",
    "dist",
    "dist/**",
    "coverage",
    "coverage/**",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "*.log",
    "src/generated/**"
  ],
  "projectCopy.excludeContentPatterns": [
    "**/*.png",
    "**/*.svg"
  ]
}
```

## Development

```bash
npm run compile
npm run lint
npm test
```

Core modules:

- `ConfigurationService`
- `FileProcessor`
- `ProjectTreeGenerator`
- `OutputFormatter`
- `IgnoreUtils`

`projectCopy.ignorePatterns` and `projectCopy.excludeContentPatterns` are resource-scoped, so you can put them in `.vscode/settings.json` for a specific project or workspace folder.

This extension is based on an MIT-licensed project and uses its own VS Code extension identity.

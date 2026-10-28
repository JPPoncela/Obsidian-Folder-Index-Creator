# Obsidian Plugin Spec: Folder Index

Build an Obsidian community plugin in TypeScript called **Folder Index**. It automatically creates an index note inside every newly created folder, optionally filled from a template note, and can backfill index notes into existing folders on demand.

Deliver three files that work with the official `obsidianmd/obsidian-sample-plugin` build setup: `main.ts`, `settings.ts`, and `manifest.json`. Use only public Obsidian APIs (no `@ts-ignore`, no `app.commands`, no Node or Electron APIs), so the plugin works on desktop and mobile and is suitable for the community plugin directory. The code must compile under the sample plugin's `strict` TypeScript settings.

---

## 1. Manifest

```json
{
  "id": "folder-index",
  "name": "Folder Index",
  "version": "1.0.0",
  "minAppVersion": "1.0.0",
  "description": "Automatically creates an _INDEX file inside every new folder.",
  "author": "JP",
  "isDesktopOnly": false
}
```

The plugin folder name must equal the manifest `id` (`folder-index`).

---

## 2. File layout

| File | Contents |
|---|---|
| `settings.ts` | Everything about settings: the `FolderIndexSettings` interface, `DEFAULT_SETTINGS`, the helper functions that interpret settings, and the `FolderIndexSettingTab` class |
| `main.ts` | The plugin lifecycle, new-folder handling, backfill, template loading, file creation, and the confirmation modal |
| `manifest.json` | Plugin metadata (above) |

`settings.ts` needs the plugin's type, and `main.ts` needs the settings tab. To avoid a runtime circular import, `settings.ts` must use a **type-only** import: `import type FolderIndexPlugin from './main';`. The build still bundles everything into a single `main.js`.

---

## 3. Settings (`settings.ts`)

Persist with `loadData()` / `saveData()`.

```ts
export interface FolderIndexSettings {
  fileName: string;
  templateNotePath: string;
  excludedFolders: string; // newline-separated paths
}

export const DEFAULT_SETTINGS: FolderIndexSettings = {
  fileName: '_INDEX',
  templateNotePath: '',
  excludedFolders: '',
};
```

There is **no** "starting content" text setting. The template note is the only template source.

### 3.1 Exported helper functions

These are plain functions (not plugin methods) that take the settings object, so all interpretation of settings lives in `settings.ts`.

- **`getIndexFileName(settings): string`**: trim whitespace, strip illegal filename characters (`\ / : * ? " < > |`), fall back to `_INDEX` if empty, and append `.md` if the name doesn't already end in `.md` (case-insensitive).
- **`getTemplateNotePath(settings): string`**: trim the value; return `''` if empty; otherwise apply `normalizePath` and append `.md` if missing.
- **`getExcludedPaths(settings): string[]`**: split on newlines, trim each line, apply `normalizePath`, strip leading and trailing slashes, drop empty lines.
- **`isExcluded(settings, folder: TFolder): boolean`**: true if `folder.path === excluded` **or** `folder.path.startsWith(excluded + '/')` for any excluded path. Excluding a folder also excludes everything beneath it. Matching is exact and case-sensitive.
- **`renderTemplate(template: string, folder: TFolder): string`**: replace placeholders (case-insensitive, whitespace inside the braces allowed):
  - `{{folder}}` becomes `folder.name`
  - `{{path}}` becomes `folder.path`

### 3.2 Settings tab (`FolderIndexSettingTab extends PluginSettingTab`)

`display()` calls `containerEl.empty()` and builds four `Setting` rows in this order:

1. **Index file name** (text input, placeholder is the default). Description: `.md` is added automatically if left off.
2. **Template note** (text input, placeholder `Templates/Folder index.md`). Description: optional path to an existing note whose content is used for new index files; supports `{{folder}}` and `{{path}}`; if empty, or if the note can't be found, new index files are created empty.
3. **Excluded folders** (text area, about 5 rows by 40 columns, placeholder `Attachments` and `Templates` on separate lines). Description: one vault-relative folder path per line; excluded folders and everything inside them are skipped, both for new folders and for the backfill.
4. **Add index file to existing folders** with a **"Run now"** button that calls `this.plugin.backfillIndexFiles()` directly. Description: mentions the user will be asked to confirm first and that existing files are never overwritten.

Each input saves on change via `this.plugin.saveSettings()`.

---

## 4. Plugin behavior (`main.ts`)

Imports from `obsidian`: `App`, `Modal`, `Notice`, `Plugin`, `Setting`, `TFile`, `TFolder`, `normalizePath`. Imports from `./settings`: `DEFAULT_SETTINGS`, `FolderIndexSettingTab`, `FolderIndexSettings`, `getIndexFileName`, `getTemplateNotePath`, `isExcluded`, `renderTemplate`.

### 4.1 Plugin class

- Default export `FolderIndexPlugin extends Plugin`.
- Declare the settings property with an initializer so strict property checks pass: `settings: FolderIndexSettings = { ...DEFAULT_SETTINGS };`
- `loadSettings()` uses `Object.assign({}, DEFAULT_SETTINGS, await this.loadData())`. Because saved data is merged over the defaults, old saved settings (including a leftover `template` value from earlier versions) are harmless and ignored.
- `onload()`: load settings, add the settings tab, register the `create` listener (4.2), and add the command (4.5).

### 4.2 Auto-create on new folders

- Register the vault `create` listener **inside `this.app.workspace.onLayoutReady`**, using `this.registerEvent`, so it is cleaned up on unload and doesn't fire for every existing item at startup.
- Ignore anything that is not a `TFolder`.
- For each new folder, call `handleNewFolder(folder)` (fire-and-forget with `void`).

### 4.3 `handleNewFolder(folder)` (delayed re-check)

Folders that arrive from sync tools or from a drag-and-drop copy fire `create` before their contents exist. To avoid colliding with an incoming index file:

1. Wait `NEW_FOLDER_DELAY_MS` (constant, **750 ms**) using a small `sleep` helper.
2. Confirm the folder still exists at the same path: `this.app.vault.getAbstractFileByPath(folder.path) === folder`. If not, return.
3. If `folder.children.length > 0`, return. Folders that arrive with contents are never indexed.
4. Otherwise call `createIndexFile(folder)`.

### 4.4 Template loading and file creation

**`getTemplate(): Promise<string>`**

1. `notePath = getTemplateNotePath(this.settings)`. If empty, return `''`.
2. Look up the note with `getAbstractFileByPath(notePath)`. If it is a `TFile`, return `await this.app.vault.read(file)`.
3. Otherwise `console.warn` that the template note was not found and an empty index file will be created, and return `''`.

**`createIndexFile(folder): Promise<boolean>`** (shared by the new-folder handler and the backfill; returns `true` only if a file was created)

1. Return `false` if `isExcluded(this.settings, folder)`.
2. Build the path with `normalizePath(`${folder.path}/${getIndexFileName(this.settings)}`)`.
3. Return `false` if `getAbstractFileByPath(path)` finds something (never overwrite).
4. Compute `content = renderTemplate(await this.getTemplate(), folder)` and call `this.app.vault.create(path, content)`. With no template, `content` is an empty string, so the file is created empty.
5. Wrap steps 4 in try/catch. On error, `console.error` with the prefix `Folder Index:` and return `false`.

### 4.5 Backfill and command

- One command: id `backfill-index-files`, name **"Add index file to all existing folders"**, callback calls `this.backfillIndexFiles()`.
- `backfillIndexFiles(): void` is used by **both** the command and the settings "Run now" button:
  1. Compute `getBackfillTargets()`.
  2. If there are no targets, show `new Notice('Every eligible folder already has an index file.')` and return (no modal).
  3. Otherwise open a `ConfirmBackfillModal` showing the count. On confirm, loop through the targets calling `createIndexFile`, then show `new Notice(`Created ${created} index file(s).`)` with the number actually created.
- `getBackfillTargets(): TFolder[]` returns all folders from `this.app.vault.getAllLoadedFiles()` that satisfy **all** of:
  - is a `TFolder`
  - is not the vault root (`!f.isRoot()`)
  - **is not the config folder and not inside it**: `f.path !== configDir && !f.path.startsWith(configDir + '/')`, where `configDir = this.app.vault.configDir`. Use `configDir`, not a hardcoded `.obsidian`, because users can rename it. This applies **regardless of the exclusion list**.
  - is not excluded (`!isExcluded(this.settings, f)`)
  - does not already contain the index file (existence check on the normalized path)

The modal's count must equal what the backfill will actually attempt, which is why both use `getBackfillTargets()`.

### 4.6 Confirmation modal

`ConfirmBackfillModal extends Modal`, constructed with `(app, count, onConfirm)`.

- Heading: **"Add index files?"**
- Body: "This will create N new index file(s) in existing folders. Existing files are never overwritten." Use correct singular and plural for "file".
- Two buttons in a `Setting` row:
  - **Cancel** closes the modal.
  - A call-to-action button (`.setCta()`) labeled "Create N file(s)" with correct plural. It closes the modal, then awaits `onConfirm`.
- `onClose()` empties `contentEl`.

---

## 5. Explicit non-goals and known tradeoffs

- Changing the file name or editing the template note does **not** rename, rewrite, or delete previously created index files.
- Renaming a folder does not update its index heading.
- Only `{{folder}}` and `{{path}}` are replaced. Syntax from Obsidian's core Templates plugin (`{{date}}`, `{{title}}`) or Templater (`<% %>`) is **not** processed and will appear literally.
- If the template note path is set but the note can't be found, the plugin silently falls back to an empty index file and only logs a warning to the developer console.
- The template note path is typed manually (no file picker).
- A folder that gets a file placed inside it within the 750 ms delay will not receive an index.
- Empty folders arriving via sync will still be indexed (Obsidian gives no reliable way to distinguish them from UI-created folders).
- The backfill is not undoable.
- Exclusions only prevent future index files; they never remove existing ones.
- Case-insensitive file systems: an existing `_index.md` may not be detected by the existence check, in which case `vault.create` throws and the error is logged and swallowed.

---

## 6. Acceptance tests

Run in a test vault after `npm install` and `npm run dev`, with the plugin enabled:

1. With no template note set, create a folder in the file explorer. After about a second, an **empty** `_INDEX.md` appears inside it.
2. Create `Templates/Folder index.md` containing `# {{folder}}` and `Path: {{path}}`. Set it as the template note, create a new folder, and confirm the index file contains the folder's name and path.
3. Set the template note path to a note that doesn't exist, create a folder, and confirm an empty index file is created and a warning appears in the developer console.
4. Add `Attachments` to Excluded folders, then create `Attachments/2026`. No index file is created in either folder.
5. Restart Obsidian. Existing folders do **not** suddenly gain index files.
6. Copy a folder that already contains notes into the vault. No extra index file is created in it.
7. Run "Add index file to all existing folders". A modal shows the correct count. Cancel does nothing. Confirm creates exactly that many files.
8. Run the backfill a second time. A notice says every eligible folder already has an index file, and no modal appears.
9. The config folder (`.obsidian` by default) never receives an index file from the backfill, even when it isn't on the exclusion list.
10. Change the file name to `README`, create a new folder, and confirm the file is named `README.md`.
11. The "Run now" button in settings behaves identically to the command palette command.
12. Disable and re-enable the plugin. New folders are still handled exactly once (no duplicate listeners).
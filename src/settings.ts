import { App, PluginSettingTab, Setting, TFolder, normalizePath } from 'obsidian';
import type FolderIndexPlugin from './main';

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

/** Returns the final file name, always ending in .md and free of illegal characters. */
export function getIndexFileName(settings: FolderIndexSettings): string {
  let name = settings.fileName.trim().replace(/[\\/:*?"<>|]/g, '');
  if (!name) name = DEFAULT_SETTINGS.fileName;
  if (!name.toLowerCase().endsWith('.md')) name += '.md';
  return name;
}

/** Returns the normalized template note path (with .md), or '' if none is set. */
export function getTemplateNotePath(settings: FolderIndexSettings): string {
  const trimmed = settings.templateNotePath.trim();
  if (!trimmed) return '';
  const path = normalizePath(trimmed);
  return path.toLowerCase().endsWith('.md') ? path : `${path}.md`;
}

/** Parses the exclusion setting into a clean list of vault-relative folder paths. */
export function getExcludedPaths(settings: FolderIndexSettings): string[] {
  return settings.excludedFolders
    .split('\n')
    .map((line) => normalizePath(line.trim()).replace(/^\/+|\/+$/g, ''))
    .filter((line) => line.length > 0);
}

/** True if the folder, or any folder above it, is on the exclusion list. */
export function isExcluded(settings: FolderIndexSettings, folder: TFolder): boolean {
  return getExcludedPaths(settings).some(
    (excluded) =>
      folder.path === excluded || folder.path.startsWith(excluded + '/')
  );
}

/** Fills in the template placeholders for a given folder. */
export function renderTemplate(template: string, folder: TFolder): string {
  return template
    .replace(/{{\s*folder\s*}}/gi, folder.name)
    .replace(/{{\s*path\s*}}/gi, folder.path);
}

export class FolderIndexSettingTab extends PluginSettingTab {
  plugin: FolderIndexPlugin;

  constructor(app: App, plugin: FolderIndexPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Index file name')
      .setDesc(
        'Name of the file created in each new folder. ".md" is added automatically if you leave it off.'
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.fileName)
          .setValue(this.plugin.settings.fileName)
          .onChange(async (value) => {
            this.plugin.settings.fileName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Template note')
      .setDesc(
        'Optional. Path to an existing note (for example "Templates/Folder index.md") whose content is used for new index files. ' +
          "Supports {{folder}} and {{path}}. If empty, or if the note can't be found, new index files are created empty."
      )
      .addText((text) =>
        text
          .setPlaceholder('Templates/Folder index.md')
          .setValue(this.plugin.settings.templateNotePath)
          .onChange(async (value) => {
            this.plugin.settings.templateNotePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc(
        'One folder path per line, relative to the vault root (for example "Attachments" or "Projects/Archive"). ' +
          'Excluded folders and everything inside them are skipped, both for new folders and for the backfill.'
      )
      .addTextArea((area) => {
        area
          .setPlaceholder('Attachments\nTemplates')
          .setValue(this.plugin.settings.excludedFolders)
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value;
            await this.plugin.saveSettings();
          });
        area.inputEl.rows = 5;
        area.inputEl.cols = 40;
      });

    new Setting(containerEl)
      .setName('Add index file to existing folders')
      .setDesc(
        "Creates the index file in every folder that doesn't have one yet. You'll be asked to confirm first. Existing files are never overwritten."
      )
      .addButton((button) =>
        button
          .setButtonText('Run now')
          .onClick(() => this.plugin.backfillIndexFiles())
      );
  }
}
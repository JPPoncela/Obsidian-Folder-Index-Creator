import {
  App,
  Modal,
  Notice,
  Plugin,
  Setting,
  TFile,
  TFolder,
  normalizePath,
} from 'obsidian';
import {
  DEFAULT_SETTINGS,
  FolderIndexSettingTab,
  FolderIndexSettings,
  getIndexFileName,
  getTemplateNotePath,
  isExcluded,
  renderTemplate,
} from './settings';

// How long to wait after a folder is created before checking whether it is
// still empty. Gives sync tools and drag-and-drop copies time to bring in contents.
const NEW_FOLDER_DELAY_MS = 750;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default class FolderIndexPlugin extends Plugin {
  settings: FolderIndexSettings = { ...DEFAULT_SETTINGS };

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new FolderIndexSettingTab(this.app, this));

    // Wait for the vault to finish loading, otherwise Obsidian fires
    // a "create" event for every existing file and folder on startup.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on('create', (item) => {
          if (!(item instanceof TFolder)) return;
          void this.handleNewFolder(item);
        })
      );
    });

    this.addCommand({
      id: 'backfill-index-files',
      name: 'Add index file to all existing folders',
      callback: () => this.backfillIndexFiles(),
    });
  }

  /**
   * Handles a newly created folder. Waits briefly, then only creates the index
   * if the folder still exists and is still empty. Folders that arrive with
   * contents (sync, drag-and-drop copy) are skipped so we don't collide with
   * an incoming index file.
   */
  async handleNewFolder(folder: TFolder): Promise<void> {
    await sleep(NEW_FOLDER_DELAY_MS);

    // The folder may have been deleted or renamed during the delay.
    if (this.app.vault.getAbstractFileByPath(folder.path) !== folder) return;

    if (folder.children.length > 0) return;

    await this.createIndexFile(folder);
  }

  /** Folders that would receive an index file if the backfill ran right now. */
  getBackfillTargets(): TFolder[] {
    // Always skip the config folder, regardless of the exclusion list.
    // Uses configDir rather than a hardcoded ".obsidian" because users can rename it.
    const configDir = this.app.vault.configDir;
    const indexName = getIndexFileName(this.settings);

    return this.app.vault
      .getAllLoadedFiles()
      .filter(
        (f): f is TFolder =>
          f instanceof TFolder &&
          !f.isRoot() &&
          f.path !== configDir &&
          !f.path.startsWith(configDir + '/') &&
          !isExcluded(this.settings, f) &&
          !this.app.vault.getAbstractFileByPath(
            normalizePath(`${f.path}/${indexName}`)
          )
      );
  }

  /** Counts eligible folders, asks for confirmation, then creates the index files. */
  backfillIndexFiles(): void {
    const targets = this.getBackfillTargets();

    if (targets.length === 0) {
      new Notice('Every eligible folder already has an index file.');
      return;
    }

    new ConfirmBackfillModal(this.app, targets.length, async () => {
      let created = 0;
      for (const folder of targets) {
        if (await this.createIndexFile(folder)) created++;
      }
      new Notice(`Created ${created} index file(s).`);
    }).open();
  }

  /** Returns the template note's content, or an empty string if no template is set or found. */
  async getTemplate(): Promise<string> {
    const notePath = getTemplateNotePath(this.settings);
    if (!notePath) return '';

    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }

    console.warn(
      `Folder Index: template note "${notePath}" not found, creating an empty index file instead.`
    );
    return '';
  }

  /** Creates the index file in a folder if allowed and missing. Returns true if created. */
  async createIndexFile(folder: TFolder): Promise<boolean> {
    if (isExcluded(this.settings, folder)) return false;

    const path = normalizePath(
      `${folder.path}/${getIndexFileName(this.settings)}`
    );
    if (this.app.vault.getAbstractFileByPath(path)) return false;

    try {
      const content = renderTemplate(await this.getTemplate(), folder);
      await this.app.vault.create(path, content);
      return true;
    } catch (err) {
      console.error(`Folder Index: could not create ${path}`, err);
      return false;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class ConfirmBackfillModal extends Modal {
  private count: number;
  private onConfirm: () => void | Promise<void>;

  constructor(app: App, count: number, onConfirm: () => void | Promise<void>) {
    super(app);
    this.count = count;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Add index files?' });
    contentEl.createEl('p', {
      text:
        `This will create ${this.count} new index file${this.count === 1 ? '' : 's'} ` +
        'in existing folders. Existing files are never overwritten.',
    });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText('Cancel').onClick(() => this.close())
      )
      .addButton((button) =>
        button
          .setButtonText(`Create ${this.count} file${this.count === 1 ? '' : 's'}`)
          .setCta()
          .onClick(async () => {
            this.close();
            await this.onConfirm();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}
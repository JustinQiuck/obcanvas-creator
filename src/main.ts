import { Notice, Plugin, type TAbstractFile } from 'obsidian';
import { isRecovery, type Recovery } from './model';
import { VaultRecords, PROJECT_ROOT, errorMessage } from './storage/vault-records';
import { FilmView, VIEW_TYPE } from './obsidian-view';

export default class ObCanvasPlugin extends Plugin {
  records!: VaultRecords;
  private ready = false;
  private drafts = new Map<string, Recovery>();
  private activeSessions = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();
  async onload() {
    const saved: unknown = await this.loadData();
    if (saved != null) {
      if (typeof saved !== 'object' || !('version' in saved) || saved.version !== 1 || !('drafts' in saved) || !Array.isArray(saved.drafts)) throw new Error('草稿备份格式无法识别，已保留原文件，请先检查插件 data.json。');
      for (const entry of saved.drafts) {
        if (!entry || typeof entry.id !== 'string' || !isRecovery(entry.recovery) || this.drafts.has(entry.id)) throw new Error('草稿备份存在无效或重复记录，已保留原文件。');
        this.drafts.set(entry.id, entry.recovery);
      }
    }
    this.records = new VaultRecords(this.app.vault);
    this.ready = true;
    this.registerView(VIEW_TYPE, leaf => new FilmView(leaf, this));
    this.addRibbonIcon('clapperboard', '打开影视画布', () => { void this.openView(); });
    this.addCommand({ id: 'open-film-view', name: '打开影视画布', callback: () => { void this.openView(); } });
    this.addCommand({ id: 'open-another-film-view', name: '在新标签页打开影视画布', callback: () => { void this.openView(true); } });
    const changed = (file: TAbstractFile) => {
      if (file.path === PROJECT_ROOT || file.path.startsWith(PROJECT_ROOT + '/')) void this.records.refresh();
    };
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if ([file.path, oldPath].some(p => p === PROJECT_ROOT || p.startsWith(PROJECT_ROOT + '/'))) void this.records.refresh();
    }));
    this.app.workspace.onLayoutReady(() => { void this.records.refresh(); });
  }
  async openView(newTab = false) {
    const leaf = !newTab && this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] || this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  claimSession() {
    const existing = [...this.drafts.keys()].find(id => !this.activeSessions.has(id));
    const id = existing ?? crypto.randomUUID();
    this.activeSessions.add(id);
    return { id, recovery: this.drafts.get(id) };
  }
  releaseSession(id: string) { this.activeSessions.delete(id); }
  updateDraft(id: string, recovery: Recovery | null) {
    if (JSON.stringify(this.drafts.get(id) ?? null) === JSON.stringify(recovery)) return;
    if (recovery) this.drafts.set(id, recovery); else this.drafts.delete(id);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flushDrafts().catch(() => {}); }, 150);
  }
  async flushDrafts() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const payload = { version: 1, drafts: [...this.drafts].map(([id, recovery]) => ({ id, recovery })) };
    this.writing = this.writing.catch(() => {}).then(() => this.saveData(payload));
    try { await this.writing; }
    catch (error) { new Notice(`草稿备份失败：${errorMessage(error)}。请保留当前输入并重试保存。`); throw error; }
  }
  onunload() {
    if (!this.ready) return;
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.records.dispose();
    void this.flushDrafts().catch(() => {});
  }
}

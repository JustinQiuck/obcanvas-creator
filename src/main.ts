import { Notice, Plugin, requestUrl, type TAbstractFile } from 'obsidian';
import { isRecovery, type Recovery } from './model';
import { VaultRecords, PROJECT_ROOT, errorMessage } from './storage/vault-records';
import { FilmView, VIEW_TYPE } from './obsidian-view';
import { VaultLayout, LAYOUT_PATH } from './storage/vault-layout';
import { VaultMedia, mediaKind } from './storage/vault-media';
import { ChatClient, readAISettings, defaultAISettings, type AISettings } from './ai/chat-client';
import { VaultExtractions, EXTRACTIONS_ROOT } from './storage/vault-extractions';
import { ExtractionService } from './ai/extraction-service';
import { assetSkill, builtinAssetSkills } from './ai/skills';
import { VaultSkills, SKILLS_PATH } from './storage/vault-skills';
import { AISettingsTab } from './ui/ai-settings';
import { StoryboardService } from './ai/storyboard-service';
import { storyboardSkill } from './ai/storyboard-skills';
import { STORYBOARDS_ROOT, VaultStoryboards } from './storage/vault-storyboards';
import { ModelProfiles, readModelConfig, legacyProfileId, type ModelConfig, type ModelProfile } from './ai/model-profiles';

export default class ObCanvasPlugin extends Plugin {
  records!: VaultRecords;
  layout!: VaultLayout;
  media!: VaultMedia;
  models!: ModelProfiles;
  get aiSettings() { return this.models?.selected() ?? { ...defaultAISettings }; }
  private savedExtras: Record<string, unknown> = {};
  private sessionSecrets = new Map<string, string>();
  private savingModel = false;
  chat = new ChatClient(async request => { const r = await requestUrl({ ...request, throw: false }); return { status: r.status, text: r.text }; });
  extractions!: ExtractionService;
  storyboards!: StoryboardService;
  skills!: VaultSkills;
  private ready = false;
  private drafts = new Map<string, Recovery>();
  private activeSessions = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();
  async onload() {
    const saved: unknown = await this.loadData();
    if (saved != null) {
      if (typeof saved !== 'object' || !('version' in saved) || saved.version !== 1 || !('drafts' in saved) || !Array.isArray(saved.drafts)) throw new Error('草稿备份格式无法识别，已保留原文件，请先检查插件 data.json。');
      this.savedExtras = { ...saved };
      for (const entry of saved.drafts) {
        if (!entry || typeof entry.id !== 'string' || !isRecovery(entry.recovery) || this.drafts.has(entry.id)) throw new Error('草稿备份存在无效或重复记录，已保留原文件。');
        this.drafts.set(entry.id, entry.recovery);
      }
    }
    this.models = new ModelProfiles(readModelConfig(this.savedExtras.models, this.savedExtras.ai), next => this.flushDrafts(next));
    this.skills = new VaultSkills(this.app.vault, builtinAssetSkills);
    this.records = new VaultRecords(this.app.vault);
    this.layout = new VaultLayout(this.app.vault);
    this.media = new VaultMedia(this.app, this.records);
    this.extractions = new ExtractionService(this.records, new VaultExtractions(this.app.vault), this.chat, () => this.aiSettings, settings => this.getAISecret('id' in settings ? String(settings.id) : undefined), assetSkill);
    this.storyboards = new StoryboardService(this.records, new VaultStoryboards(this.app.vault), this.chat, () => this.aiSettings, settings => this.getAISecret('id' in settings ? String(settings.id) : undefined), storyboardSkill);
    this.addSettingTab(new AISettingsTab(this.app, this));
    this.ready = true;
    this.registerView(VIEW_TYPE, leaf => new FilmView(leaf, this));
    this.addRibbonIcon('clapperboard', '打开影视画布', () => { void this.openView(); });
    this.addCommand({ id: 'open-film-view', name: '打开影视画布', callback: () => { void this.openView(); } });
    this.addCommand({ id: 'open-another-film-view', name: '在新标签页打开影视画布', callback: () => { void this.openView(true); } });
    const changed = (file: TAbstractFile) => {
      if (file.path === SKILLS_PATH || file.path === PROJECT_ROOT) void this.skills.refresh();
      if (file.path.startsWith(EXTRACTIONS_ROOT + '/')) { void this.extractions.refresh(); return; }
      if (file.path.startsWith(STORYBOARDS_ROOT + '/')) { void this.storyboards.refresh(); return; }
      if (file.path === LAYOUT_PATH) void this.layout.refresh();
      else if (file.path === PROJECT_ROOT || file.path.startsWith(PROJECT_ROOT + '/')) void this.records.refresh();
      if (!('extension' in file) || mediaKind(file.path)) this.media.changed();
    };
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if ([file.path, oldPath].some(p => p === PROJECT_ROOT || p.startsWith(PROJECT_ROOT + '/'))) void this.records.refresh();
      if ([file.path, oldPath].some(p => p === SKILLS_PATH || p === PROJECT_ROOT)) void this.skills.refresh();
      if ([file.path, oldPath].some(p => p.startsWith(STORYBOARDS_ROOT + '/'))) void this.storyboards.refresh();
      if (file.path === LAYOUT_PATH || oldPath === LAYOUT_PATH) void this.layout.refresh();
      void this.media.renamed(file.path, oldPath).catch(e => new Notice(`素材位置更新失败：${errorMessage(e)}。请在镜头中重新关联。`));
    }));
    this.app.workspace.onLayoutReady(() => { void this.records.refresh(); void this.layout.refresh(); void this.extractions.refresh(); void this.storyboards.refresh(); void this.skills.refresh(); });
  }
  async openView(newTab = false) {
    let leaf = newTab ? undefined : this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      try { leaf = this.app.workspace.getLeaf('tab'); }
      catch (error) {
        // During unload/last-tab closure the workspace may temporarily have no tab group.
        if (!(error instanceof Error) || error.message !== 'No tab group found.') throw error;
        leaf = this.app.workspace.getLeaf(false);
      }
    }
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
  async flushDrafts(models?: ModelConfig) {
    clearTimeout(this.timer);
    this.timer = undefined;
    const drafts = [...this.drafts].map(([id, recovery]) => ({ id, recovery }));
    this.writing = this.writing.catch(() => {}).then(async () => {
      const config = models ?? (this.savedExtras.models as ModelConfig | undefined) ?? this.models.getSnapshot();
      await this.saveData({ ...this.savedExtras, version: 1, models: config, ai: readAISettings(config.profiles.find(p => p.id === config.selectedId)), drafts });
      this.savedExtras.models = config;
    });
    try { await this.writing; }
    catch (error) { new Notice(`草稿备份失败：${errorMessage(error)}。请保留当前输入并重试保存。`); throw error; }
  }
  getAISecret(id = this.models.getSnapshot().selectedId) { return this.app.secretStorage?.getSecret(this.secretName(id)) ?? this.sessionSecrets.get(id) ?? ''; }
  private secretName(id: string) { return id === legacyProfileId ? 'obcanvas-creator-text-model' : `obcanvas-creator-text-model-${id}`; }
  async saveModelProfile(profile: ModelProfile, key?: string) {
    if (this.savingModel) throw new Error('模型配置正在保存，请稍后重试。');
    this.savingModel = true;
    const previous = this.getAISecret(profile.id);
    const set = (value: string) => { if (this.app.secretStorage) this.app.secretStorage.setSecret(this.secretName(profile.id), value); else this.sessionSecrets.set(profile.id, value); };
    try { if (key !== undefined) set(key); await this.models.save(profile); }
    catch (error) { if (key !== undefined) set(previous); throw error; }
    finally { this.savingModel = false; }
  }
  async saveAISettings(settings: AISettings, key?: string) {
    await this.saveModelProfile({ ...readAISettings(settings), id: this.models.selected()?.id ?? legacyProfileId, name: this.models.selected()?.name ?? '原有模型配置' }, key);
  }
  onunload() {
    if (!this.ready) return;
    this.extractions.cancel();
    void this.extractions.flushDrafts().catch(() => {}).finally(() => this.extractions.dispose());
    this.storyboards.cancel();
    void this.storyboards.flushDrafts().catch(() => {}).finally(() => this.storyboards.dispose());
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.records.dispose();
    this.skills.dispose();
    void this.layout.flush().catch(e => new Notice(errorMessage(e))).finally(() => this.layout.dispose());
    this.media.dispose();
    void this.flushDrafts().catch(() => {});
  }
}

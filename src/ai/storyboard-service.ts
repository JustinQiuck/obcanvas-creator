import { ChatClient, type AISettings } from './chat-client';
import { parseStoryboardSuggestions, parseStoryboardTask, storyboardContext, storyboardInputVersion, type StoryboardTask } from './storyboard-model';
import { storyboardPrompt, type StoryboardSkill } from './storyboard-skill';
import { VaultRecords, errorMessage } from '../storage/vault-records';
import { VaultStoryboards } from '../storage/vault-storyboards';

export class StoryboardService {
  private snapshot: { tasks: StoryboardTask[]; busy: boolean; scriptId: string; message: string } = { tasks: [], busy: false, scriptId: '', message: '' };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private owner = '';
  private disposed = false;
  private drafts = new Map<string, { base: StoryboardTask; next: StoryboardTask }>();
  private saving?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private records: VaultRecords, private storage: VaultStoryboards, private chat: ChatClient, private settings: () => AISettings, private secret: (settings: AISettings) => string, private skill: StoryboardSkill) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(patch: Partial<typeof this.snapshot>) { if (this.disposed) return; this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }
  private keep(task: StoryboardTask) { this.emit({ tasks: [task, ...this.snapshot.tasks.filter(item => item.id !== task.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }); }
  async refresh() {
    if (this.snapshot.busy || this.drafts.size || this.saving) return;
    try { this.emit({ tasks: await this.storage.list() }); }
    catch (error) { this.emit({ message: errorMessage(error) }); }
  }
  hasDrafts() { return this.drafts.size > 0; }
  editDraft(base: StoryboardTask, next: StoryboardTask) {
    if (this.snapshot.busy || this.saving) throw new Error('请等待当前保存完成。');
    if (JSON.stringify(this.snapshot.tasks.find(task => task.id === base.id)) !== JSON.stringify(base)) throw new Error('分镜预览已更新，请检查最新内容。');
    this.drafts.set(base.id, { base: this.drafts.get(base.id)?.base ?? base, next });
    this.keep(next); this.emit({ message: '分镜预览有未保存修改。' }); clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flushDrafts().catch(() => {}); }, 800);
  }
  async flushDrafts() {
    clearTimeout(this.timer);
    if (this.saving) return this.saving;
    if (!this.drafts.size) return;
    this.emit({ busy: true });
    this.saving = (async () => {
      for (const [id, draft] of this.drafts) {
        const normalized = { ...draft.next, items: draft.next.items.map(item => ({ ...item, title: item.title.trim(), intent: item.intent.trim(), framing: item.framing.trim(), camera: item.camera.trim(), start: item.start.trim(), action: item.action.trim(), end: item.end.trim(), sound: item.sound.trim(), keyframePrompt: item.keyframePrompt.trim() })) };
        const validated = parseStoryboardTask(JSON.stringify(normalized));
        const saved = await this.storage.save(validated, draft.base); this.drafts.delete(id); this.keep(saved);
      }
      this.emit({ message: '分镜预览修改已保存。' });
    })();
    try { await this.saving; }
    catch (error) { this.emit({ message: `分镜预览未保存：${errorMessage(error)} 修改仍保留在当前窗口，请修正或重试。` }); throw error; }
    finally { this.saving = undefined; this.emit({ busy: false }); }
  }
  async start(scriptId: string, owner: string) {
    if (this.snapshot.busy || this.disposed) throw new Error('已有分镜任务正在执行，请等待或取消。');
    this.emit({ busy: true, scriptId, message: '' });
    this.owner = owner; this.controller = new AbortController();
    const skill = structuredClone(this.skill), prompt = storyboardPrompt(skill);
    try {
      const settings = { ...this.settings() }, secret = this.secret(settings);
      const script = await this.records.requireRecord(scriptId);
      await this.records.refresh();
      const catalog = this.records.getSnapshot();
      if (catalog.problems.length) throw new Error('请先修复项目中无法读取或重复的记录。');
      const context = storyboardContext(script, catalog.records), version = await storyboardInputVersion(script, catalog.records);
      this.emit({ message: '正在设计分镜与起始关键帧，等待模型返回… 最长约 2 分钟，可取消。' });
      const raw = await this.chat.complete(settings, secret, [{ role: 'system', content: prompt }, { role: 'user', content: context }], this.controller.signal);
      if (this.controller.signal.aborted) throw new Error('已取消分镜设计。');
      this.emit({ message: '模型已返回，正在核对原文依据并保存预览…' });
      const { items, issues } = parseStoryboardSuggestions(raw, script);
      const task: StoryboardTask = { version: 1, id: crypto.randomUUID(), revision: 0, scriptId, sceneId: script.sceneId!, inputVersion: version, scriptText: script.body, createdAt: new Date().toISOString(), model: settings.model, skill: { ...skill, prompt }, status: 'review', items, issues };
      this.keep(await this.storage.save(task));
      await this.records.refresh();
      const latest = await this.records.requireRecord(scriptId), changed = await storyboardInputVersion(latest, this.records.getSnapshot().records) !== version;
      this.emit({ message: changed ? '剧本或关联资产已更新，分镜预览已保留供对照；请按最新内容重新生成。' : issues.length ? `已保留 ${items.length} 镜可编辑预览，另有 ${issues.length} 镜未通过检查。` : '分镜预览已保存。先检查镜头理由、首尾边界与静态关键帧。' });
    } catch (error) { this.emit({ message: errorMessage(error) }); throw error; }
    finally { this.controller = undefined; this.owner = ''; this.emit({ busy: false }); }
  }
  cancel(owner?: string) { if (!owner || owner === this.owner) this.controller?.abort(); }
  dispose() { this.cancel(); clearTimeout(this.timer); this.disposed = true; this.listeners.clear(); }
}

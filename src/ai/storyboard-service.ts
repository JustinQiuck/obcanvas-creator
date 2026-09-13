import { ChatClient, type AISettings } from './chat-client';
import { parseStoryboardSuggestions, parseStoryboardTask, storyboardContext, storyboardInputVersion, type StoryboardTask } from './storyboard-model';
import { storyboardPrompt, type StoryboardSkill } from './storyboard-skill';
import { VaultRecords, errorMessage } from '../storage/vault-records';
import { VaultStoryboards } from '../storage/vault-storyboards';
import { projectOf } from '../model';
import type { VaultStoryboardSettings } from '../storage/vault-storyboard-settings';

export class StoryboardService {
  private snapshot: { tasks: StoryboardTask[]; busy: boolean; scriptId: string; message: string } = { tasks: [], busy: false, scriptId: '', message: '' };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private owner = '';
  private disposed = false;
  private drafts = new Map<string, { base: StoryboardTask; next: StoryboardTask }>();
  private saving?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private records: VaultRecords, private storage: VaultStoryboards, private chat: ChatClient, private settings: () => AISettings, private secret: (settings: AISettings) => string, private skill: StoryboardSkill, readonly preferences?: VaultStoryboardSettings) {}
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
    if (base.status !== 'review' || next.status !== 'review') throw new Error('已经开始入卡的预览已冻结，请编辑正式镜头或继续保存。');
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
    try {
      const settings = { ...this.settings() }, secret = this.secret(settings);
      const initialCatalog = this.records.getSnapshot().records, initialScript = initialCatalog.find(r => r.id === scriptId);
      if (this.preferences && !initialScript) throw new Error('请等待剧本读取完成。');
      const selected = this.preferences?.resolve(scriptId, projectOf(initialScript!, initialCatalog));
      const skill = structuredClone(selected?.skill ?? this.skill), direction = selected?.choice;
      const prompt = storyboardPrompt(skill) + (direction ? `\n\n本次作品方向（不改变剧本事实与输出协议）：\n${JSON.stringify(direction)}` : '');
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
      const task: StoryboardTask = { version: 1, id: crypto.randomUUID(), revision: 0, scriptId, sceneId: script.sceneId!, inputVersion: version, scriptText: script.body, createdAt: new Date().toISOString(), model: settings.model, skill: { ...skill, prompt }, ...(direction ? { direction } : {}), status: 'review', items, issues };
      this.keep(await this.storage.save(task));
      await this.records.refresh();
      const latest = await this.records.requireRecord(scriptId), changed = await storyboardInputVersion(latest, this.records.getSnapshot().records) !== version;
      this.emit({ message: changed ? '剧本或关联资产已更新，分镜预览已保留供对照；请按最新内容重新生成。' : issues.length ? `已保留 ${items.length} 镜可编辑预览，另有 ${issues.length} 镜未通过检查。` : '分镜预览已保存。先检查镜头理由、首尾边界与静态关键帧。' });
    } catch (error) { this.emit({ message: errorMessage(error) }); throw error; }
    finally { this.controller = undefined; this.owner = ''; this.emit({ busy: false }); }
  }
  async apply(base: StoryboardTask) {
    if (this.snapshot.busy || this.disposed) throw new Error('请等待当前任务完成。');
    await this.flushDrafts();
    if (this.snapshot.busy || this.disposed) throw new Error('请等待当前任务完成。');
    let task = this.snapshot.tasks.find(t => t.id === base.id);
    if (!task || JSON.stringify(task) !== JSON.stringify(base)) throw new Error('预览已保存或更新，请重新检查后确认。');
    if (task.status === 'complete') return;
    if (!task.items.length || task.issues?.length) throw new Error('分镜存在缺失或未通过检查的条目，请修正并重新生成完整预览后入卡。');
    this.emit({ busy: true, scriptId: task.scriptId });
    const verify = async () => {
      await this.records.refresh();
      if (this.records.getSnapshot().problems.length) throw new Error('项目有无法读取的记录，请修复后继续。');
      const script = await this.records.requireRecord(task!.scriptId);
      if (script.kind !== 'script' || script.sceneId !== task!.sceneId || await storyboardInputVersion(script, this.records.getSnapshot().records) !== task!.inputVersion) throw new Error('剧本或关联资产已更新，未覆盖正式镜头；本次预览与已保存部分保留。');
      return script;
    };
    try {
      await verify();
      task = await this.storage.save({ ...task, status: 'applying', application: task.application ?? task.items.map(item => ({ itemId: item.id, shotId: crypto.randomUUID(), applied: false })) }, task); this.keep(task);
      for (const entry of task.application!) {
        if (this.disposed) throw new Error('插件已关闭，已保存部分保留。');
        const script = await verify(), item = task.items.find(i => i.id === entry.itemId)!;
        await this.records.ensureStoryboardShot(script, item, task.id, entry.shotId, entry.applied);
        task = await this.storage.save({ ...task, application: task.application!.map(e => e.itemId === entry.itemId ? { ...e, applied: true } : e) }, task); this.keep(task);
      }
      task = await this.storage.save({ ...task, status: 'complete' }, task); this.keep(task);
      this.emit({ message: `已确认 ${task.items.length} 个正式镜头。可在画布中继续编辑，原有素材与采用决定保留。` });
    } catch (error) {
      if (task?.application) { try { task = await this.storage.save({ ...task, status: 'partial' }, task); this.keep(task); } catch {} }
      this.emit({ message: `入卡未完成：${errorMessage(error)} 已保存镜头保留，可检查后继续保存。` }); throw error;
    } finally { this.emit({ busy: false }); }
  }
  cancel(owner?: string) { if (!owner || owner === this.owner) this.controller?.abort(); }
  dispose() { this.cancel(); clearTimeout(this.timer); this.disposed = true; this.listeners.clear(); }
}

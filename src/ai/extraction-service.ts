import { isProductionAsset, projectOf, type FilmRecord } from '../model';
import { VaultRecords, errorMessage } from '../storage/vault-records';
import { VaultExtractions } from '../storage/vault-extractions';
import { extractionContext, inputVersion, parseSuggestions, parseTask, type ExtractionTask } from './extraction-model';
import { skillPrompt, type AssetSkill } from './skill-model';
import { ChatClient, type AISettings } from './chat-client';

export class ExtractionService {
  private snapshot: { tasks: ExtractionTask[]; busy: boolean; scriptId: string; message: string } = { tasks: [], busy: false, scriptId: '', message: '' };
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private owner = '';
  private disposed = false;
  private drafts = new Map<string, { base: ExtractionTask; next: ExtractionTask }>();
  private saving?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private records: VaultRecords, private storage: VaultExtractions, private chat: ChatClient, private settings: () => AISettings, private secret: (settings: AISettings) => string, private skill: { version: string; instructions: string }) {}
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(patch: Partial<typeof this.snapshot>) { if (this.disposed) return; this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  private keep(task: ExtractionTask) { this.emit({ tasks: [task, ...this.snapshot.tasks.filter(t => t.id !== task.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }); }
  async refresh() {
    if (this.snapshot.busy || this.drafts.size || this.saving) return;
    try { this.emit({ tasks: await this.storage.list() }); }
    catch (e) { this.emit({ message: errorMessage(e) }); }
  }
  hasDrafts() { return this.drafts.size > 0; }
  editDraft(base: ExtractionTask, next: ExtractionTask) {
    if (this.snapshot.busy || this.saving || base.status !== 'review') throw new Error('请等待当前保存完成。');
    if (JSON.stringify(this.snapshot.tasks.find(t => t.id === base.id)) !== JSON.stringify(base)) throw new Error('清单已更新，请检查最新内容。');
    this.drafts.set(base.id, { base: this.drafts.get(base.id)?.base ?? base, next }); this.keep(next);
    this.emit({ message: '清单有未保存修改。' }); clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flushDrafts().catch(() => {}); }, 800);
  }
  async flushDrafts(): Promise<void> {
    clearTimeout(this.timer);
    if (this.saving) return this.saving;
    if (!this.drafts.size) return;
    this.emit({ busy: true });
    this.saving = (async () => {
      for (const [id, { base, next }] of this.drafts) {
        const normalized = { ...next, items: next.items.map(i => ({ ...i, title: i.title.trim(), needs: [...new Set(i.needs.map(s => s.trim()).filter(Boolean))], unresolved: i.unresolved.map(s => s.trim()).filter(Boolean) })) };
        const saved = await this.storage.save(normalized, base); this.drafts.delete(id); this.keep(saved);
      }
      this.emit({ message: '清单修改已保存。' });
    })();
    try { await this.saving; }
    catch (e) { this.emit({ message: `清单未保存：${errorMessage(e)} 修改仍保留在当前窗口，请重试。` }); throw e; }
    finally { this.saving = undefined; this.emit({ busy: false }); }
  }
  private async guard(scriptId: string, work: () => Promise<void>) {
    if (this.snapshot.busy || this.disposed) throw new Error('已有整理任务正在执行，请等待或取消。');
    this.emit({ busy: true, scriptId, message: '' });
    try { await work(); }
    catch (e) { this.emit({ message: errorMessage(e) }); throw e; }
    finally { this.emit({ busy: false }); }
  }
  async start(scriptId: string, owner: string, selectedSkill?: AssetSkill) {
    const skill = selectedSkill ? structuredClone(selectedSkill) : this.skill;
    const prompt = selectedSkill ? skillPrompt(selectedSkill) : skill.instructions;
    return this.guard(scriptId, async () => {
      this.owner = owner; this.controller = new AbortController();
      try {
        const settings = { ...this.settings() }, secret = this.secret(settings);
        const script = await this.records.requireRecord(scriptId);
        await this.records.refresh();
        const catalog = this.records.getSnapshot();
        if (catalog.problems.length) throw new Error('请先修复项目中无法读取或重复的资产记录。');
        const context = extractionContext(script, catalog.records), version = await inputVersion(script);
        this.emit({ message: '正在整理拍摄资产，等待模型返回… 最长约 2 分钟，可取消。' });
        const raw = await this.chat.complete(settings, secret, [{ role: 'system', content: prompt }, { role: 'user', content: context }], this.controller.signal);
        if (this.controller.signal.aborted) throw new Error('已取消整理。');
        this.emit({ message: '模型已返回，正在核对剧本依据并保存清单…' });
        const { items, issues } = parseSuggestions(raw, script, catalog.records);
        const task: ExtractionTask = { version: 1, id: crypto.randomUUID(), revision: 0, scriptId, sceneId: script.sceneId!, inputVersion: version, scriptText: script.body, createdAt: new Date().toISOString(), model: settings.model, skillVersion: skill.version, ...(selectedSkill ? { skill: { ...skill as AssetSkill, prompt } } : {}), status: 'review', items, issues };
        this.keep(await this.storage.save(task));
        const changed = await inputVersion(await this.records.requireRecord(scriptId)) !== version;
        this.emit({ message: changed ? '剧本已更新，清单已保留供对照；请按最新剧本重新整理。' : issues.length ? `已保留 ${items.length} 项可确认资产，另有 ${issues.length} 项未通过检查。请查看下方原因。` : '资产清单已保存，请检查后确认。' });
      } finally { this.controller = undefined; this.owner = ''; }
    });
  }
  cancel(owner?: string) { if (!owner || owner === this.owner) this.controller?.abort(); }
  async edit(base: ExtractionTask, next: ExtractionTask) {
    await this.guard(base.scriptId, async () => {
      if (base.status !== 'review') throw new Error('已经开始应用的清单不能修改，请继续完成保存或重新整理。');
      const validated = parseTask(JSON.stringify(next));
      this.keep(await this.storage.save(validated, base));
    });
  }
  async apply(base: ExtractionTask) {
    await this.guard(base.scriptId, async () => {
      if (base.status === 'complete') return;
      if (!base.items.length) throw new Error('没有可确认的资产，请查看问题说明后重新整理。');
      let task = base;
      const verifyScript = async (): Promise<FilmRecord> => {
        const script = await this.records.requireRecord(task.scriptId);
        if (script.kind !== 'script' || script.sceneId !== task.sceneId || await inputVersion(script) !== task.inputVersion) throw new Error('剧本已更新，请按最新剧本重新整理；已保存的资产和本次清单均保留。');
        return script;
      };
      const sourceScript = await verifyScript();
      await this.records.refresh();
      const projectCatalog = this.records.getSnapshot().records;
      for (const item of task.items.filter(i => i.action === 'reuse')) {
        const r = await this.records.requireRecord(item.targetId);
        if (!isProductionAsset(r) || r.kind !== item.kind) throw new Error('复用目标类型不符，请重新选择已有资产。');
        if (projectOf(r, projectCatalog) !== projectOf(sourceScript, projectCatalog)) throw new Error('复用资产属于其他剧本项目，请重新选择。');
      }
      task = await this.storage.save({ ...task, status: 'applying' }, task); this.keep(task);
      try {
        for (let index = 0; index < task.items.length; index++) {
          const item = task.items[index]!;
          if (item.applied) continue;
          if (this.disposed) throw new Error('插件已关闭；已保存内容保留，下次可继续应用。');
          const script = await verifyScript();
          if (item.action !== 'ignore') {
            if (item.action === 'create') await this.records.ensureExtractedAsset(item, script.sceneId!, task.id);
            else {
              const asset = await this.records.requireRecord(item.targetId);
              if (asset.kind !== item.kind) throw new Error('复用资产类型已变化。');
            }
            await this.records.attachScriptAsset(script, item.targetId);
          }
          task = await this.storage.save({ ...task, items: task.items.map((i, n) => n === index ? { ...i, applied: true } : i) }, task); this.keep(task);
        }
        task = await this.storage.save({ ...task, status: 'complete' }, task); this.keep(task);
        this.emit({ message: '资产已关联到剧本。点击资产卡绑定参考图。' });
      } catch (e) {
        // Keep the last durable checkpoint. If this write also fails, applying is resumable.
        try { task = await this.storage.save({ ...task, status: 'partial' }, task); this.keep(task); } catch {}
        throw new Error(`保存尚未全部完成：${errorMessage(e)} 已完成 ${task.items.filter(i => i.applied).length}/${task.items.length} 项；可重试，不会重复创建。`);
      }
    });
  }
  dispose() { this.cancel(); clearTimeout(this.timer); this.disposed = true; this.listeners.clear(); }
}

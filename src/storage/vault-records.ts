import type { Vault, TFile } from 'obsidian';
import { FilmRecord, Draft, RecordError, ConflictError, newRecord, parseRecord, patchRecord, patchMedia, patchOrder, orderedShots, decideMedia, type MediaRef, type RecordKind, type CardLink, kindLabels, patchLinks } from '../model';
import { isProductionAsset, patchAssetDetails, type AssetDetails, projectOf, LEGACY_PROJECT_ID } from '../model';
import type { AssetItem } from '../ai/extraction-model';

export const PROJECT_ROOT = '影视项目';
export type Catalog = { records: FilmRecord[]; problems: string[]; loading: boolean };
type VaultAccess = Pick<Vault, 'getMarkdownFiles' | 'read' | 'process' | 'create' | 'createFolder' | 'getAbstractFileByPath' | 'trash'>;
export class VaultRecords {
  private snapshot: Catalog = { records: [], problems: [], loading: true };
  private listeners = new Set<() => void>();
  private revision = 0;
  private disposed = false;
  constructor(private vault: VaultAccess) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose() { this.disposed = true; this.revision++; this.listeners.clear(); }
  private async scan() {
    const problems: string[] = [];
    const entries: { record: FilmRecord; file: TFile }[] = [];
    for (const file of this.vault.getMarkdownFiles().filter(f => f.path.startsWith(PROJECT_ROOT + '/'))) {
      try { const record = parseRecord(await this.vault.read(file), file.path); if (record) entries.push({ record, file }); }
      catch (error) { problems.push(`${file.path}：${errorMessage(error)}`); }
    }
    const counts = new Map<string, number>();
    for (const { record } of entries) {
      if (record.kind === 'project') continue;
      const parent = entries.find(e => e.record.id === record.sceneId && e.record.kind === 'scene')?.record;
      if (record.projectId && record.projectId !== LEGACY_PROJECT_ID && !entries.some(e => e.record.kind === 'project' && e.record.id === record.projectId)) problems.push(`${record.path}：所属剧本项目缺失，请恢复项目笔记。`);
      if (parent && record.projectId && projectOf(parent) !== record.projectId) problems.push(`${record.path}：剧本项目与所属场次不一致，请检查原笔记。`);
    }
    entries.forEach(e => counts.set(e.record.id, (counts.get(e.record.id) ?? 0) + 1));
    for (const [id, count] of counts) if (count > 1) problems.push(`编号 ${id} 出现重复，请修复后再编辑。`);
    return { entries: entries.filter(e => counts.get(e.record.id) === 1), problems };
  }
  async refresh() {
    const revision = ++this.revision;
    try {
      const { entries, problems } = await this.scan();
      if (this.disposed || revision !== this.revision) return;
      this.snapshot = { records: entries.map(e => e.record), problems, loading: false };
    } catch (error) {
      if (this.disposed || revision !== this.revision) return;
      this.snapshot = { ...this.snapshot, problems: [errorMessage(error)], loading: false };
    }
    this.listeners.forEach(listener => listener());
  }
  async save(base: FilmRecord, draft: Draft) {
    const { entries } = await this.scan();
    const entry = entries.find(e => e.record.id === base.id);
    if (!entry) throw new RecordError('记录已删除、编号重复或无法读取，本地输入已保留。');
    const written = await this.vault.process(entry.file, current => patchRecord(current, base, draft));
    const record = parseRecord(written, entry.file.path)!;
    await this.refresh();
    return record;
  }
  async trashCard(base: FilmRecord) {
    if (base.kind === 'scene' || base.kind === 'project') throw new RecordError(`${kindLabels[base.kind]}包含其他卡片，不能通过卡片删除操作移除。`);
    const { entries } = await this.scan();
    const entry = entries.find(e => e.record.id === base.id);
    if (!entry) throw new RecordError('卡片已移除、编号重复或无法读取，未执行删除。');
    if (JSON.stringify(entry.record) !== JSON.stringify(base)) throw new ConflictError('卡片已被修改，请取消后重新检查再删除。');
    // Keep incoming links and saved positions so restoring the note restores its context.
    // Media files and other records are never passed to trash.
    await this.vault.trash(entry.file, false);
    await this.refresh();
  }
  async removeMediaCard(sceneId: string, ref: MediaRef) {
    const { entries, problems } = await this.scan();
    if (problems.length) throw new RecordError('项目中有无法读取的记录，请先修复再移除素材卡。');
    const affected = entries.filter(e => e.record.sceneId === sceneId && (e.record.media?.some(m => m.id === ref.id) || e.record.links?.some(l => l.from === `m:${ref.id}`)));
    if (affected.some(e => e.record.media?.some(m => m.id === ref.id && m.decision === 'adopted'))) throw new RecordError('此素材已有镜头采用，请先在对应镜头取消采用，再移除素材卡。');
    if (affected.some(e => e.record.media?.some(m => m.id === ref.id && m.path !== ref.path))) throw new ConflictError('素材位置已变化，请重新检查后操作。');
    try {
      for (const entry of affected) await this.vault.process(entry.file, raw => {
        const current = parseRecord(raw, entry.file.path);
        if (!current || JSON.stringify(current) !== JSON.stringify(entry.record)) throw new ConflictError('关联卡片已修改，请重新检查后操作。');
        return patchLinks(patchMedia(raw, current.id, items => items.filter(m => m.id !== ref.id)), current.id, links => links.filter(l => l.from !== `m:${ref.id}`));
      });
    } catch (e) { throw new RecordError(`素材卡尚未全部移除：${errorMessage(e)} 已完成的移除会保留，可重试；源文件未删除。`); }
    finally { await this.refresh(); }
  }
  async create(kind: RecordKind, sceneId?: string, projectId?: string, name?: string) {
    const { entries, problems } = await this.scan();
    if (problems.length) throw new RecordError('请先修复无法读取或归属异常的项目记录。');
    const parent = entries.find(e => e.record.id === sceneId && e.record.kind === 'scene')?.record;
    if (!['scene', 'project'].includes(kind) && !parent && !(projectId && ['person', 'setting', 'prop', 'asset', 'frame'].includes(kind) && !sceneId)) throw new RecordError('所属场次不存在或无法读取。');
    if (parent && projectId && projectOf(parent) !== projectId) throw new RecordError('所属场次不在当前剧本项目。');
    projectId = kind === 'project' ? undefined : projectId ?? (parent ? projectOf(parent) : LEGACY_PROJECT_ID);
    if (projectId && projectId !== LEGACY_PROJECT_ID && !entries.some(e => e.record.kind === 'project' && e.record.id === projectId)) throw new RecordError('所属剧本项目不存在。');
    const existing = this.vault.getAbstractFileByPath(PROJECT_ROOT);
    if (existing && 'extension' in existing) throw new RecordError('“影视项目”已被同名文件占用，请先调整文件名。');
    if (!existing) {
      try { await this.vault.createFolder(PROJECT_ROOT); }
      catch (error) { if (!this.vault.getAbstractFileByPath(PROJECT_ROOT)) throw error; }
    }
    const id = crypto.randomUUID();
    const title = name?.trim() || '新' + kindLabels[kind];
    const path = `${PROJECT_ROOT}/${title}-${id}.md`;
    const source = newRecord(kind, id, title, sceneId, projectId);
    await this.vault.create(path, source);
    await this.refresh();
    if (kind === 'shot') {
      try { await this.appendOrder(sceneId!, id); }
      catch (e) { throw new RecordError(`镜头已创建，但顺序保存失败：${errorMessage(e)}。请在镜头顺序列表中调整位置后重试，不必重复创建。`); }
    }
    return parseRecord(source, path)!;
  }
  async nameProject(base: FilmRecord, title: string) {
    if (base.kind !== 'project' || !title.trim()) throw new RecordError('请填写剧本项目名称。');
    if (base.path) return this.save(base, { title: title.trim(), body: base.body });
    if (base.id !== LEGACY_PROJECT_ID) throw new RecordError('剧本项目不存在。');
    const source = newRecord('project', LEGACY_PROJECT_ID, title.trim());
    const path = `${PROJECT_ROOT}/原有剧本项目.md`;
    if ((await this.scan()).entries.some(e => e.record.id === LEGACY_PROJECT_ID)) throw new ConflictError('项目名称已更新，请重新读取。');
    await this.vault.create(path, source); await this.refresh();
    return parseRecord(source, path)!;
  }
  async editMedia(shotId: string, edit: (items: MediaRef[]) => MediaRef[]) {
    const { entries } = await this.scan();
    const entry = entries.find(e => e.record.id === shotId);
    if (!entry) throw new RecordError('镜头不存在、编号重复或无法读取，未修改关联。');
    await this.vault.process(entry.file, current => patchMedia(current, shotId, edit));
    await this.refresh();
  }
  async editLinks(recordId: string, edit: (links: CardLink[]) => CardLink[]) {
    const { entries } = await this.scan();
    const entry = entries.find(e => e.record.id === recordId);
    if (!entry) throw new RecordError('卡片无法读取，未修改关系。');
    await this.vault.process(entry.file, raw => patchLinks(raw, recordId, links => {
      const next = edit(links);
      for (const link of next.filter(l => !links.some(old => old.id === l.id && old.from === l.from && old.role === l.role))) {
        const owners = entries.filter(e => link.from === `r:${e.record.id}` || link.from.startsWith('m:') && e.record.media?.some(m => `m:${m.id}` === link.from));
        if (!owners.length || owners.every(e => projectOf(e.record, entries.map(e => e.record)) !== projectOf(entry.record, entries.map(e => e.record)))) throw new RecordError('只能关联当前剧本项目中的卡片或素材。');
      }
      for (const l of next.filter(l => l.role === '拍摄资产' && !links.some(old => old.id === l.id && old.from === l.from && old.role === l.role))) {
        if (entry.record.kind !== 'script' || !entries.some(e => `r:${e.record.id}` === l.from && isProductionAsset(e.record))) throw new RecordError('拍摄资产必须关联已有的人物、场景或道具与剧本。');
      }
      return next;
    }));
    await this.refresh();
  }
  async updateAssetDetails(base: FilmRecord, details: AssetDetails) {
    const { entries } = await this.scan();
    const entry = entries.find(e => e.record.id === base.id);
    if (!entry) throw new RecordError('资产无法读取。');
    await this.vault.process(entry.file, raw => patchAssetDetails(raw, base, details));
    await this.refresh();
  }
  async requireRecord(id: string) {
    const { entries } = await this.scan();
    const entry = entries.find(e => e.record.id === id);
    if (!entry) throw new RecordError('记录已删除、编号重复或无法读取。');
    return entry.record;
  }
  async ensureExtractedAsset(item: AssetItem, sceneId: string, taskId: string) {
    const { entries, problems } = await this.scan();
    if (problems.length) throw new RecordError('项目中存在损坏或重复记录，请先处理后再创建资产。');
    const origin = `资产整理任务：${taskId}/${item.id}`;
    const existing = entries.find(e => e.record.id === item.targetId)?.record;
    if (existing) {
      if (existing.source !== origin || existing.kind !== item.kind || existing.sceneId !== sceneId) throw new ConflictError('预分配的资产编号已被其他记录使用。');
      return existing;
    }
    const scene = entries.find(e => e.record.id === sceneId && e.record.kind === 'scene')?.record;
    if (!scene) throw new RecordError('所属场次已移除。');
    const path = `${PROJECT_ROOT}/资产-${item.targetId}.md`;
    let raw = newRecord(item.kind, item.targetId, item.title, sceneId, projectOf(scene));
    let base = parseRecord(raw, path)!;
    raw = patchRecord(raw, base, { title: item.title, body: item.description, source: origin });
    base = parseRecord(raw, path)!;
    raw = patchAssetDetails(raw, base, { unresolved: item.unresolved, needs: item.needs });
    await this.vault.create(path, raw); await this.refresh();
    return parseRecord(raw, path)!;
  }
  async attachScriptAsset(base: FilmRecord, assetId: string) {
    const { entries } = await this.scan();
    const entry = entries.find(e => e.record.id === base.id && e.record.kind === 'script');
    if (!entry || !entries.some(e => e.record.id === assetId && isProductionAsset(e.record))) throw new RecordError('剧本或资产已移除，未增加关系。');
    const all = entries.map(e => e.record), asset = all.find(r => r.id === assetId)!;
    if (projectOf(entry.record, all) !== projectOf(asset, all)) throw new RecordError('只能关联同一剧本项目中的资产。');
    await this.vault.process(entry.file, raw => {
      const latest = parseRecord(raw, '')!;
      if (latest.body !== base.body || latest.title !== base.title || latest.sceneId !== base.sceneId || latest.projectId !== base.projectId) throw new ConflictError('剧本已更新，请重新核对清单。');
      return patchLinks(raw, base.id, links => links.some(l => l.role === '拍摄资产' && l.from === `r:${assetId}`) ? links : [...links, { id: crypto.randomUUID(), from: `r:${assetId}`, role: '拍摄资产' }]);
    });
    await this.refresh();
  }
  private async appendOrder(sceneId: string, id: string) {
    const { entries } = await this.scan();
    const scene = entries.find(e => e.record.id === sceneId && e.record.kind === 'scene');
    if (!scene) throw new RecordError('所属场次无法读取。');
    const existing = orderedShots(scene.record, entries.map(e => e.record)).filter(r => r.id !== id).map(r => r.id);
    await this.vault.process(scene.file, raw => patchOrder(raw, sceneId, ids => [...new Set([...ids, ...existing, id])]));
    await this.refresh();
  }
  async moveShot(base: FilmRecord, shotId: string, direction: -1 | 1) {
    const { entries } = await this.scan();
    const scene = entries.find(e => e.record.id === base.id && e.record.kind === 'scene');
    if (!scene) throw new RecordError('场次无法读取。');
    const shots = orderedShots(scene.record, entries.map(e => e.record)).map(r => r.id);
    const index = shots.indexOf(shotId), target = index + direction;
    if (index < 0 || target < 0 || target >= shots.length) throw new RecordError('镜头位置已变化，请检查最新列表。');
    [shots[index], shots[target]] = [shots[target]!, shots[index]!];
    await this.vault.process(scene.file, raw => patchOrder(raw, base.id, ids => {
      if (JSON.stringify(ids) !== JSON.stringify(base.shotOrder ?? [])) throw new ConflictError('镜头顺序已被其他窗口修改，请检查最新顺序后重试。');
      return [...shots, ...ids.filter(id => !shots.includes(id))];
    }));
    await this.refresh();
  }
  async decide(base: FilmRecord, mediaId: string, decision: NonNullable<MediaRef['decision']>, reason?: string) {
    const { entries } = await this.scan();
    const entry = entries.find(e => e.record.id === base.id && e.record.kind === 'shot');
    if (!entry) throw new RecordError('镜头无法读取，未更改选片记录。');
    await this.vault.process(entry.file, raw => decideMedia(raw, base, mediaId, decision, reason));
    await this.refresh();
  }
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }

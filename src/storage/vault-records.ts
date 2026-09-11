import type { Vault, TFile } from 'obsidian';
import { FilmRecord, Draft, RecordError, ConflictError, newRecord, parseRecord, patchRecord, patchMedia, patchOrder, orderedShots, decideMedia, type MediaRef } from '../model';

export const PROJECT_ROOT = '影视项目';
export type Catalog = { records: FilmRecord[]; problems: string[]; loading: boolean };
type VaultAccess = Pick<Vault, 'getMarkdownFiles' | 'read' | 'process' | 'create' | 'createFolder' | 'getAbstractFileByPath'>;
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
  async create(kind: 'scene' | 'shot', sceneId?: string) {
    if (kind === 'shot') {
      const { entries } = await this.scan();
      if (!entries.some(e => e.record.id === sceneId && e.record.kind === 'scene')) throw new RecordError('所属场次不存在或无法读取。');
    }
    const existing = this.vault.getAbstractFileByPath(PROJECT_ROOT);
    if (existing && 'extension' in existing) throw new RecordError('“影视项目”已被同名文件占用，请先调整文件名。');
    if (!existing) {
      try { await this.vault.createFolder(PROJECT_ROOT); }
      catch (error) { if (!this.vault.getAbstractFileByPath(PROJECT_ROOT)) throw error; }
    }
    const id = crypto.randomUUID();
    const title = kind === 'scene' ? '新场次' : '新镜头';
    const path = `${PROJECT_ROOT}/${title}-${id}.md`;
    const source = newRecord(kind, id, title, sceneId);
    await this.vault.create(path, source);
    await this.refresh();
    if (kind === 'shot') {
      try { await this.appendOrder(sceneId!, id); }
      catch (e) { throw new RecordError(`镜头已创建，但顺序保存失败：${errorMessage(e)}。请在镜头顺序列表中调整位置后重试，不必重复创建。`); }
    }
    return parseRecord(source, path)!;
  }
  async editMedia(shotId: string, edit: (items: MediaRef[]) => MediaRef[]) {
    const { entries } = await this.scan();
    const entry = entries.find(e => e.record.id === shotId && e.record.kind === 'shot');
    if (!entry) throw new RecordError('镜头不存在、编号重复或无法读取，未修改关联。');
    await this.vault.process(entry.file, current => patchMedia(current, shotId, edit));
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

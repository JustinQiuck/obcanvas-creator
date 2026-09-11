import { FuzzySuggestModal, Notice, type App, type TFile } from 'obsidian';
import type { MediaRef, FilmRecord } from '../model';
import { validMediaPath, isImagePath } from '../model';
import { errorMessage, VaultRecords, PROJECT_ROOT } from './vault-records';
export function mediaKind(path: string): 'image' | 'video' | null {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(ext)) return 'image';
  if (ext && ['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return 'video';
  return null;
}
class MediaPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private done: (file: TFile) => void) { super(app); this.setPlaceholder('搜索资料库内的图片或视频…'); this.setInstructions([{ command: '↑↓', purpose: '选择素材' }, { command: '回车', purpose: '关联到镜头' }, { command: 'Esc', purpose: '取消' }]); }
  getItems() { return this.app.vault.getFiles().filter(f => !!mediaKind(f.path)); }
  getItemText(file: TFile) { return file.path; }
  onChooseItem(file: TFile) { this.done(file); }
}
export class VaultMedia {
  private revision = 0;
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private app: App, private records: VaultRecords) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.revision;
  changed() { this.revision++; this.listeners.forEach(fn => fn()); }
  dispose() { this.listeners.clear(); }
  previewKey(ref: MediaRef) {
    const file = validMediaPath(ref.path) ? this.app.vault.getFileByPath(ref.path) : null;
    return `${ref.path}:${file ? `${file.stat.mtime}:${file.stat.size}` : 'missing'}`;
  }
  referenceReady(ref: MediaRef) { return !this.locate(ref).error && (!ref.confirmed || ref.fingerprint === this.previewKey(ref)); }
  bindReference(base: FilmRecord, ref: MediaRef, purpose: string, confirmed: boolean) {
    return this.enqueue(async () => {
      if (!isImagePath(ref.path) || this.locate(ref).error) throw new Error('请先关联可读取的参考图片。');
      await this.records.editMedia(base.id, items => {
        const current = items.find(m => m.id === ref.id);
        if (!current || JSON.stringify(current) !== JSON.stringify(ref)) throw new Error('参考图记录已更新，请检查最新关联。');
        return items.map(m => m.id === ref.id ? { ...m, purpose, confirmed, fingerprint: confirmed ? this.previewKey(m) : undefined } : m);
      });
    });
  }
  private enqueue(run: () => Promise<void>) { const next = this.queue.catch(() => {}).then(run); this.queue = next; return next; }
  locate(ref: MediaRef) {
    if (!validMediaPath(ref.path)) return { error: '素材位置无效，请重新关联。' };
    const file = this.app.vault.getFileByPath(ref.path);
    if (!file) return { error: '素材缺失，请恢复文件或重新关联。' };
    const kind = mediaKind(file.path);
    if (!kind) return { error: '暂不支持此素材格式，请重新关联图片或视频。' };
    try { return { kind, url: this.app.vault.getResourcePath(file), name: file.name }; }
    catch { return { error: '素材无法读取，请检查文件或重新关联。' }; }
  }
  pick(onSelect: (file: TFile) => Promise<void>) { new MediaPicker(this.app, file => { void onSelect(file).catch(e => new Notice(errorMessage(e))); }).open(); }
  attach(shotId: string, path: string) {
    return this.enqueue(async () => {
      if (!validMediaPath(path) || !mediaKind(path) || !this.app.vault.getFileByPath(path)) throw new Error('请选取资料库内可读取的图片或视频。');
      await this.records.refresh();
      const existing = this.records.getSnapshot().records.flatMap(r => r.media ?? []).find(m => m.path === path);
      const ref = { id: existing?.id ?? crypto.randomUUID(), path };
      await this.records.editMedia(shotId, items => items.some(m => m.path === path) ? items : [...items, ref]);
    });
  }
  remove(shotId: string, id: string) { return this.enqueue(() => this.records.editMedia(shotId, items => {
    if (items.some(m => m.id === id && m.decision === 'adopted')) throw new Error('请先取消采用，再移除这份视频。');
    return items.filter(m => m.id !== id);
  })); }
  decide(shot: FilmRecord, id: string, decision: NonNullable<MediaRef['decision']>, reason?: string) {
    return this.enqueue(async () => {
      const ref = shot.media?.find(m => m.id === id);
      if (decision === 'adopted' && (!ref || this.locate(ref).error)) throw new Error('视频文件无法读取，请先恢复或重新关联。');
      await this.records.decide(shot, id, decision, reason);
    });
  }
  async importFile(shotId: string, file: File) {
    if (!mediaKind(file.name)) throw new Error('请选择支持的图片或视频格式。');
    if (file.size > 256 * 1024 * 1024) throw new Error('超过 256 MB 的文件请先放入资料库，再使用“关联库内素材”。');
    const folder = `${PROJECT_ROOT}/素材`;
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch (e) { if (!this.app.vault.getAbstractFileByPath(folder)) throw e; }
    }
    const filename = file.name.replace(/[\\/:\x00-\x1f]/g, '_');
    const path = `${folder}/${crypto.randomUUID()}-${filename}`;
    await this.app.vault.createBinary(path, await file.arrayBuffer());
    try { await this.attach(shotId, path); }
    catch (e) { throw new Error(`文件已复制到 ${path}，关联失败：${errorMessage(e)}。可通过“关联库内素材”重试。`); }
  }
  relink(ref: MediaRef, path: string) {
    return this.enqueue(async () => {
      if (!validMediaPath(path) || !mediaKind(path) || !this.app.vault.getFileByPath(path)) throw new Error('请选择资料库内的图片或视频。');
      await this.records.refresh();
      const records = this.records.getSnapshot().records;
      if (path !== ref.path && records.some(r => r.media?.some(m => m.id === ref.id && m.decision === 'adopted'))) throw new Error('这份视频已有镜头采用，请先取消采用，再替换文件。');
      const canonical = records.flatMap(r => r.media ?? []).find(m => m.path === path);
      // Relinking deliberately applies to every shot using this media ID.
      for (const record of records.filter(r => r.media?.some(m => m.id === ref.id))) {
        await this.records.editMedia(record.id, items => {
          const current = items.find(m => m.id === ref.id);
          if (current && current.path !== ref.path && current.path !== path) throw new Error('素材关联已被修改，请载入最新记录后重试。');
          if (canonical && canonical.id !== ref.id && items.some(m => m.id === canonical.id)) throw new Error('该镜头已关联目标素材，请移除旧关联，避免合并时丢失选片记录。');
          const updated = items.map(m => m.id === ref.id ? { ...m, id: canonical?.id ?? m.id, path, ...(path !== m.path ? { decision: undefined, reason: undefined, confirmed: false, fingerprint: undefined } : {}) } : m);
          return updated.filter((m, i) => updated.findIndex(other => other.id === m.id) === i);
        });
      }
    });
  }
  renamed(path: string, oldPath: string) {
    this.changed();
    return this.enqueue(async () => {
      await this.records.refresh();
      for (const record of this.records.getSnapshot().records.filter(r => r.media?.some(m => m.path === oldPath || m.path.startsWith(oldPath + '/')))) {
        await this.records.editMedia(record.id, items => items.map(m => {
          if (m.path !== oldPath && !m.path.startsWith(oldPath + '/')) return m;
          const renamed = { ...m, path: path + m.path.slice(oldPath.length) };
          // Preserve confirmation only for the same file contents after a rename.
          const oldStamp = m.fingerprint?.slice(m.path.length), stamp = this.previewKey(renamed).slice(renamed.path.length);
          return { ...renamed, ...(m.confirmed ? oldStamp === stamp ? { fingerprint: this.previewKey(renamed) } : { confirmed: false, fingerprint: undefined } : {}) };
        }));
      }
      this.changed();
    });
  }
}

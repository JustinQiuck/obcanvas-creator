import { FuzzySuggestModal, Notice, type App, type TFile } from 'obsidian';
import type { MediaRef } from '../model';
import { validMediaPath } from '../model';
import { errorMessage, VaultRecords } from './vault-records';
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
  remove(shotId: string, id: string) { return this.enqueue(() => this.records.editMedia(shotId, items => items.filter(m => m.id !== id))); }
  relink(ref: MediaRef, path: string) {
    return this.enqueue(async () => {
      if (!validMediaPath(path) || !mediaKind(path) || !this.app.vault.getFileByPath(path)) throw new Error('请选择资料库内的图片或视频。');
      await this.records.refresh();
      const records = this.records.getSnapshot().records;
      const canonical = records.flatMap(r => r.media ?? []).find(m => m.path === path);
      // Relinking deliberately applies to every shot using this media ID.
      for (const record of records.filter(r => r.kind === 'shot' && r.media?.some(m => m.id === ref.id))) {
        await this.records.editMedia(record.id, items => {
          const current = items.find(m => m.id === ref.id);
          if (current && current.path !== ref.path && current.path !== path) throw new Error('素材关联已被修改，请载入最新记录后重试。');
          const updated = items.map(m => m.id === ref.id ? { ...m, id: canonical?.id ?? m.id, path } : m);
          return updated.filter((m, i) => updated.findIndex(other => other.id === m.id) === i);
        });
      }
    });
  }
  renamed(path: string, oldPath: string) {
    this.changed();
    return this.enqueue(async () => {
      await this.records.refresh();
      for (const record of this.records.getSnapshot().records.filter(r => r.kind === 'shot' && r.media?.some(m => m.path === oldPath || m.path.startsWith(oldPath + '/')))) {
        await this.records.editMedia(record.id, items => items.map(m => m.path === oldPath || m.path.startsWith(oldPath + '/') ? { ...m, path: path + m.path.slice(oldPath.length) } : m));
      }
      this.changed();
    });
  }
}

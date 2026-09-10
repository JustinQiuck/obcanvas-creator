import type { TFile, Vault } from 'obsidian';
import type { Position, ViewportTransform } from '../canvas/types';
import { errorMessage, PROJECT_ROOT } from './vault-records';

export const LAYOUT_PATH = `${PROJECT_ROOT}/画布布局.json`;
export type SceneLayout = { viewport: ViewportTransform; positions: Record<string, Position> };
export type LayoutData = { version: 1; scenes: Record<string, SceneLayout> };
type Change = { sceneId: string; shotId?: string; value: Position | ViewportTransform };
const empty = (): LayoutData => ({ version: 1, scenes: {} });
export const defaultScene = (): SceneLayout => ({ viewport: { x: 32, y: 32, k: 1 }, positions: {} });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const position = (v: unknown): v is Position => object(v) && typeof v.x === 'number' && Number.isFinite(v.x) && typeof v.y === 'number' && Number.isFinite(v.y);
export function parseLayout(raw: string): LayoutData {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || data.version !== 1 || !object(data.scenes)) throw new Error('布局格式或版本无法识别，原文件已保留。');
  for (const scene of Object.values(data.scenes)) {
    if (!object(scene) || !position(scene.viewport) || !('k' in scene.viewport) || typeof scene.viewport.k !== 'number' || scene.viewport.k < .05 || scene.viewport.k > 5 || !Number.isFinite(scene.viewport.k) || !object(scene.positions) || !Object.values(scene.positions).every(position)) throw new Error('布局坐标无效，原文件已保留。');
  }
  return data as LayoutData;
}
export function applyChanges(data: LayoutData, changes: Change[]): LayoutData {
  const next = structuredClone(data);
  for (const change of changes) {
    // defineProperty handles arbitrary external record IDs without prototype mutation.
    if (!Object.hasOwn(next.scenes, change.sceneId)) Object.defineProperty(next.scenes, change.sceneId, { value: defaultScene(), enumerable: true, writable: true, configurable: true });
    const scene = next.scenes[change.sceneId]!;
    if (change.shotId) Object.defineProperty(scene.positions, change.shotId, { value: change.value, enumerable: true, writable: true, configurable: true });
    else scene.viewport = change.value as ViewportTransform;
  }
  return next;
}
type Access = Pick<Vault, 'getAbstractFileByPath' | 'read' | 'process' | 'create' | 'createFolder'>;
export class VaultLayout {
  private snapshot = { data: empty(), status: 'loading', message: '' };
  private listeners = new Set<() => void>();
  private pending: Change[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private writing?: Promise<void>;
  private revision = 0;
  private disposed = false;
  constructor(private vault: Access) {}
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit() { if (!this.disposed) this.listeners.forEach(fn => fn()); }
  private file() {
    const file = this.vault.getAbstractFileByPath(LAYOUT_PATH);
    if (file && !('extension' in file)) throw new Error('布局路径被文件夹占用。');
    return file as TFile | null;
  }
  async refresh() {
    if (this.pending.length || this.writing || this.disposed) return;
    const revision = ++this.revision;
    try {
      const file = this.file();
      const data = file ? parseLayout(await this.vault.read(file)) : empty();
      if (revision !== this.revision || this.disposed) return;
      this.snapshot = { data, status: 'saved', message: '' };
    } catch (e) { if (revision !== this.revision || this.disposed) return; this.snapshot = { ...this.snapshot, status: 'error', message: errorMessage(e) }; }
    this.emit();
  }
  update(sceneId: string, value: ViewportTransform | Position, shotId?: string) {
    if (!sceneId || this.snapshot.status === 'loading' || this.disposed) return;
    this.revision++;
    const change = { sceneId, value, shotId };
    this.pending = this.pending.filter(p => p.sceneId !== sceneId || p.shotId !== shotId);
    this.pending.push(change);
    this.snapshot = { data: applyChanges(this.snapshot.data, [change]), status: 'pending', message: '' };
    this.emit(); clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 180);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.writing) { await this.writing; return this.flush(); }
    if (!this.pending.length) return;
    const batch = this.pending.splice(0);
    const run = async () => {
      try {
        if (!this.vault.getAbstractFileByPath(PROJECT_ROOT)) await this.vault.createFolder(PROJECT_ROOT);
        let file = this.file();
        if (!file) {
          try { file = await this.vault.create(LAYOUT_PATH, JSON.stringify(empty())); }
          catch (e) { file = this.file(); if (!file) throw e; }
        }
        const raw = await this.vault.process(file, current => JSON.stringify(applyChanges(parseLayout(current), batch), null, 2) + '\n');
        this.snapshot = { data: applyChanges(parseLayout(raw), this.pending), status: this.pending.length ? 'pending' : 'saved', message: '' };
      } catch (e) {
        this.pending.unshift(...batch);
        this.snapshot = { ...this.snapshot, status: 'error', message: `布局保存失败：${errorMessage(e)}。请重试后再退出。` };
        throw e;
      } finally { this.emit(); }
    };
    this.writing = run();
    try { await this.writing; } finally { this.writing = undefined; }
    if (this.pending.length) await this.flush();
  }
  dispose() { this.disposed = true; this.revision++; clearTimeout(this.timer); this.listeners.clear(); }
}

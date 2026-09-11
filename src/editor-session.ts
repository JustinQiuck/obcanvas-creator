import { ConflictError, Draft, FilmRecord, Recovery, sameContent, draftOf } from './model';
import { errorMessage, VaultRecords } from './storage/vault-records';
export type EditorState = {
  selectedId: string | null; base: FilmRecord | null; draft: Draft;
  dirty: boolean; saving: boolean; status: 'ready' | 'dirty' | 'saved' | 'changed' | 'error' | 'conflict'; message: string;
};
export class EditorSession {
  private state: EditorState;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  constructor(private records: VaultRecords, recovery?: Recovery) {
    this.state = { selectedId: recovery?.base.id ?? null, base: recovery?.base ?? null, draft: recovery?.draft ?? { title: '', body: '' }, dirty: !!recovery, saving: false, status: recovery ? 'dirty' : 'ready', message: recovery ? '已恢复未保存的草稿，请检查后保存。' : '' };
    this.unsubscribe = records.subscribe(() => this.reconcile());
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  recovery(): Recovery | null { return this.state.dirty && this.state.base ? { base: this.state.base, draft: this.state.draft } : null; }
  private emit(patch: Partial<EditorState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(l => l()); }
  dispose() { this.unsubscribe(); this.listeners.clear(); }
  select(id: string) {
    if (this.state.saving || (this.state.dirty && id !== this.state.selectedId)) return false;
    if (id === this.state.selectedId) return true;
    this.emit({ selectedId: id, base: null, draft: { title: '', body: '' }, status: 'ready', message: '' });
    this.reconcile(); return true;
  }
  clearSelection() {
    if (this.state.dirty || this.state.saving) return;
    this.emit({ selectedId: null, base: null, draft: { title: '', body: '' }, status: 'ready', message: '' });
  }
  private reconcile() {
    const latest = this.records.getSnapshot().records.find(r => r.id === this.state.selectedId);
    if (!latest) {
      if (this.state.selectedId && !this.records.getSnapshot().loading) this.emit({ status: 'error', message: '镜头已移除或无法读取。未保存的输入会保留。' });
      return;
    }
    if (this.state.dirty || this.state.saving) {
      if (this.state.base && (!sameContent(latest, this.state.base) || latest.sceneId !== this.state.base.sceneId)) this.emit({ status: 'changed', message: '笔记已有更新。保存时会检查冲突，本地输入已保留。' });
      return;
    }
    this.emit({ base: latest, draft: draftOf(latest), status: 'ready', message: '' });
  }
  edit(field: keyof Draft, value: string) {
    if (!this.state.base || this.state.saving) return;
    const draft = { ...this.state.draft, [field]: value };
    const dirty = !sameContent(this.state.base, draft);
    this.emit({ draft, dirty, status: dirty ? 'dirty' : 'ready', message: '' });
    if (!dirty) this.reconcile();
  }
  async save() {
    const { base, draft } = this.state;
    if (!base || this.state.saving || !this.state.dirty) return;
    this.emit({ saving: true, message: '' });
    try {
      const record = await this.records.save(base, draft);
      this.emit({ base: record, draft: draftOf(record), dirty: false, saving: false, status: 'saved', message: '已保存到笔记。' });
    } catch (error) {
      this.emit({ saving: false, status: error instanceof ConflictError ? 'conflict' : 'error', message: errorMessage(error) });
    }
  }
  async loadLatest() {
    if (this.state.saving) return;
    await this.records.refresh();
    const record = this.records.getSnapshot().records.find(r => r.id === this.state.selectedId);
    if (!record) return;
    this.emit({ base: record, draft: draftOf(record), dirty: false, status: 'ready', message: '已载入笔记版本。' });
  }
}

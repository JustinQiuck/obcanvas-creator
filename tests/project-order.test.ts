import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vault } from 'obsidian';
import { newRecord, parseRecord, patchOrder, patchMedia, patchProjectOrder, draftOf, orderedShots, filmProjects } from '../src/model';
import { moveVisibleOrder, projectOrderView } from '../src/project-order';
import { VaultRecords } from '../src/storage/vault-records';

class MemoryVault {
  files = new Map<string, { path: string; source: string; extension: string }>();
  beforeProcess?: (path: string) => void;
  add(id: string, source: string) { const file = { path: `影视项目/${id}.md`, source, extension: 'md' }; this.files.set(file.path, file); return file; }
  getMarkdownFiles = () => [...this.files.values()];
  read = async (f: { source: string }) => f.source;
  getAbstractFileByPath = (p: string) => this.files.get(p) ?? (p === '影视项目' ? { path: p } : null);
  async process(f: { path: string; source: string }, fn: (raw: string) => string) { this.beforeProcess?.(f.path); return f.source = fn(f.source); }
  async create(path: string, source: string) { if (this.files.has(path)) throw new Error('文件已存在'); const f = { path, source, extension: 'md' }; this.files.set(path, f); return f; }
  async createFolder() {}
  async trash(f: { path: string }) { this.files.delete(f.path); }
}
async function setup(legacy = false) {
  const v = new MemoryVault(), pid = legacy ? undefined : 'p';
  if (!legacy) v.add('p', newRecord('project', 'p', '影片') + '项目说明');
  v.add('a', patchOrder(newRecord('scene', 'a', '场次 A', undefined, pid), 'a', () => ['a1', 'a2']));
  v.add('b', patchOrder(newRecord('scene', 'b', '场次 B', undefined, pid), 'b', () => ['b1']));
  for (const [id, scene] of [['a1', 'a'], ['a2', 'a'], ['b1', 'b']]) v.add(id!, patchMedia(newRecord('shot', id!, id!, scene, pid) + '原镜头正文', id!, () => [{ id: `v-${id}`, path: `素材/${id}.mp4`, decision: 'adopted' }]));
  const r = new VaultRecords(v as unknown as Vault); await r.refresh(); return { v, r, pid: pid ?? 'legacy-project' };
}
test('全片顺序仅确认时写入项目，跨场次投影不改镜头、素材和旧顺序', async () => {
  const { v, r, pid } = await setup(); const before = new Map([...v.files].map(([p, f]) => [p, f.source]));
  const d = await r.prepareProjectOrder(pid); assert.deepEqual(d.ids, ['a1', 'a2', 'b1']);
  assert.deepEqual([...v.files].map(([p, f]) => [p, f.source]), [...before]);
  await r.saveProjectOrder({ ...d, ids: ['a1', 'b1', 'a2'] });
  const p = await r.requireRecord(pid); assert.deepEqual(p.editOrder, ['a1', 'b1', 'a2']); assert.equal(p.body, '项目说明');
  assert.deepEqual(orderedShots(await r.requireRecord('a'), r.getSnapshot().records).map(r => r.id), ['a1', 'a2']);
  for (const [path, raw] of before) if (path !== p.path) assert.equal(v.files.get(path)!.source, raw);
  await assert.rejects(r.moveShot(await r.requireRecord('a'), 'a2', -1), /全片顺序已启用/); r.dispose();
});
test('已启用项目中的新镜头待排，保存失败不改原顺序且可重试', async () => {
  const { v, r, pid } = await setup(); await r.saveProjectOrder(await r.prepareProjectOrder(pid));
  const before = v.files.get('影视项目/a.md')!.source, shot = await r.create('shot', 'a', pid, '新增');
  assert.equal(v.files.get('影视项目/a.md')!.source, before);
  assert.deepEqual(projectOrderView(await r.requireRecord(pid), r.getSnapshot().records).pending.map(s => s.id), [shot.id]);
  const d = await r.prepareProjectOrder(pid); d.ids.push(shot.id);
  v.beforeProcess = () => { throw new Error('磁盘写入失败'); }; await assert.rejects(r.saveProjectOrder(d), /磁盘写入失败/);
  assert.ok(!(await r.requireRecord(pid)).editOrder!.includes(shot.id));
  v.beforeProcess = undefined; await r.saveProjectOrder(d); assert.equal((await r.requireRecord(pid)).editOrder!.at(-1), shot.id);
  assert.equal(r.getSnapshot().records.filter(x => x.id === shot.id).length, 1); r.dispose();
});
test('删除留位置，改序保留缺失编号，恢复原镜头与项目后顺序可重建', async () => {
  const { v, r, pid } = await setup(); const d = await r.prepareProjectOrder(pid); await r.saveProjectOrder({ ...d, ids: ['a1', 'b1', 'a2'] });
  const b = await r.requireRecord('b1'), raw = v.files.get(b.path)!.source; await r.trashCard(b);
  const next = await r.prepareProjectOrder(pid); next.ids = moveVisibleOrder(next.ids, new Set(['a1', 'a2']), 'a2', -1);
  assert.deepEqual(next.ids, ['a2', 'b1', 'a1']); await r.saveProjectOrder(next);
  v.add('b1', raw); await r.refresh(); assert.deepEqual(projectOrderView(await r.requireRecord(pid), r.getSnapshot().records).ordered.map(s => s.id), ['a2', 'b1', 'a1']);
  const archive = [...v.files.values()].map(f => ({ ...f })); await r.trashProject(await r.prepareProjectDeletion(pid));
  assert.equal(filmProjects(r.getSnapshot().records).length, 0);
  for (const f of archive) v.files.set(f.path, f); await r.refresh();
  assert.deepEqual((await r.requireRecord(pid)).editOrder, ['a2', 'b1', 'a1']); r.dispose();
});
test('并发顺序与成员变化拒绝覆盖，正文编辑可以与排序合并', async () => {
  const { v, r, pid } = await setup(); const d = await r.prepareProjectOrder(pid);
  const base = await r.requireRecord(pid); await r.save(base, { ...draftOf(base), body: '新的项目说明' });
  await r.saveProjectOrder(d); assert.equal((await r.requireRecord(pid)).body, '新的项目说明');
  const next = await r.prepareProjectOrder(pid); next.ids.reverse();
  v.beforeProcess = path => { if (path.endsWith('/p.md')) { const f = v.files.get(path)!; f.source = patchProjectOrder(f.source, pid, parseRecord(f.source, path)!.editOrder, ['b1', 'a1', 'a2']); } };
  await assert.rejects(r.saveProjectOrder(next), /其他窗口/); assert.deepEqual((await r.requireRecord(pid)).editOrder, ['b1', 'a1', 'a2']);
  v.beforeProcess = undefined; const old = await r.prepareProjectOrder(pid); await r.create('shot', 'a', pid);
  await assert.rejects(r.saveProjectOrder(old), /成员已变化/); r.dispose();
});
test('跨项目、非镜头、重复和未知编号拒绝，缺失旧编号不丢弃', async () => {
  const { v, r, pid } = await setup(); v.add('p2', newRecord('project', 'p2', '另片')); v.add('s2', newRecord('scene', 's2', '另场', undefined, 'p2')); v.add('foreign', newRecord('shot', 'foreign', '外部镜头', 's2', 'p2'));
  const d = await r.prepareProjectOrder(pid);
  for (const ids of [['foreign'], ['a'], ['a1', 'a1'], ['unknown']]) await assert.rejects(r.saveProjectOrder({ ...d, ids }), /只能包含本项目镜头/);
  await r.saveProjectOrder(d); await r.trashCard(await r.requireRecord('b1'));
  const after = await r.prepareProjectOrder(pid); await assert.rejects(r.saveProjectOrder({ ...after, ids: ['a1', 'a2'] }), /保留缺失镜头/);
  const p = v.files.get('影视项目/p.md')!; p.source = patchProjectOrder(p.source, pid, after.project.editOrder, ['foreign']); await r.refresh();
  assert.ok(r.getSnapshot().problems.some(p => p.includes('其他项目或非镜头'))); r.dispose();
});
test('旧虚拟项目确认时只新增项目笔记，格式检查拒绝非项目顺序', async () => {
  const { v, r, pid } = await setup(true); const before = new Map([...v.files].map(([p, f]) => [p, f.source]));
  const d = await r.prepareProjectOrder(pid); assert.equal(d.project.path, ''); assert.equal(v.files.size, before.size);
  await r.saveProjectOrder(d); assert.equal(v.files.size, before.size + 1);
  for (const [path, raw] of before) assert.equal(v.files.get(path)!.source, raw);
  assert.deepEqual((await r.requireRecord(pid)).editOrder, ['a1', 'a2', 'b1']);
  assert.throws(() => parseRecord(newRecord('scene', 'a', 'A').replace('kind: scene', 'editOrder: []\n  kind: scene'), ''));
  r.dispose();
});

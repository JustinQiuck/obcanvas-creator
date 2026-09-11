import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vault } from 'obsidian';
import { newRecord, patchMedia, patchLinks, patchOrder, orderedShots } from '../src/model';
import { VaultRecords } from '../src/storage/vault-records';
import { buildGraph } from '../src/canvas/graph';

class TrashVault {
  files = new Map<string, { path: string; source: string }>();
  bin = new Map<string, string>(); failTrash = false; failProcess = '';
  add(path: string, source: string) { const f = { path, source }; this.files.set(path, f); return f; }
  getMarkdownFiles() { return [...this.files.values()].filter(f => f.path.endsWith('.md')); }
  async read(f: { source: string }) { return f.source; }
  async process(f: { path: string; source: string }, edit: (s: string) => string) { if (f.path === this.failProcess) throw new Error('模拟写入失败'); return f.source = edit(f.source); }
  async trash(f: { path: string; source: string }, system: boolean) { assert.equal(system, false); if (this.failTrash) throw new Error('模拟回收站失败'); this.bin.set(f.path, f.source); this.files.delete(f.path); }
  port() { return this as unknown as Vault; }
}
const note = (id: string) => `影视项目/${id}.md`;
test('卡片删除进回收站、共享引用与媒体保留；恢复后顺序和引用重现', async () => {
  const vault = new TrashVault(), records = new VaultRecords(vault.port());
  vault.add(note('scene'), patchOrder(newRecord('scene', 'scene', '场次'), 'scene', () => ['shot', 'other']));
  const image = '影视项目/图.png'; vault.add(image, 'image-bytes');
  vault.add(note('shot'), patchMedia(newRecord('shot', 'shot', '镜头', 'scene'), 'shot', () => [{ id: 'media', path: image }]));
  const other = patchLinks(patchMedia(newRecord('shot', 'other', '另一个镜头', 'scene'), 'other', () => [{ id: 'media', path: image }]), 'other', () => [{ id: 'link', from: 'r:shot', role: '参考' }]);
  vault.add(note('other'), other);
  await records.refresh(); const base = await records.requireRecord('shot');
  await records.trashCard(base);
  assert.equal(buildGraph(records.getSnapshot().records, 'scene').nodes.some(n => n.id === 'r:shot'), false);
  assert.equal(vault.files.get(note('other'))!.source, other); assert.equal(vault.files.get(image)!.source, 'image-bytes');
  assert.deepEqual(orderedShots(await records.requireRecord('scene'), records.getSnapshot().records).map(r => r.id), ['other']);
  vault.add(base.path, vault.bin.get(base.path)!); await records.refresh();
  assert.deepEqual(orderedShots(await records.requireRecord('scene'), records.getSnapshot().records).map(r => r.id), ['shot', 'other']);
  assert.equal(buildGraph(records.getSnapshot().records, 'scene').edges.some(e => e.from === 'r:shot'), true);
});
test('回收站失败、卡片被修改、编号重复和场次删除均不丢失笔记', async () => {
  const vault = new TrashVault(), records = new VaultRecords(vault.port());
  const file = vault.add(note('p'), newRecord('person', 'p', '人物', 'scene'));
  const base = await records.requireRecord('p');
  vault.failTrash = true; await assert.rejects(records.trashCard(base), /回收站失败/);
  vault.failTrash = false; file.source += '新外观'; await assert.rejects(records.trashCard(base), /已被修改/);
  vault.add(note('copy'), file.source); await assert.rejects(records.trashCard(base), /编号重复/);
  vault.add(note('scene'), newRecord('scene', 'scene', '场次'));
  await assert.rejects(records.trashCard(await records.requireRecord('scene')), /场次包含/);
  assert.equal(vault.bin.size, 0); assert.ok(vault.files.has(note('p')));
});
test('移除素材卡只处理当前场次，保护已采用视频，并可重试部分写入失败', async () => {
  const vault = new TrashVault(), records = new VaultRecords(vault.port());
  const ref = { id: 'v', path: '影视项目/视频.mp4' }; vault.add(ref.path, 'video-bytes');
  const make = (id: string, scene = 's', adopted = false) => patchLinks(patchMedia(newRecord('shot', id, id, scene), id, () => [{ ...ref, ...(adopted ? { decision: 'adopted' as const } : {}) }]), id, () => [{ id: 'l', from: 'm:v', role: '参考' }]);
  const a = vault.add(note('a'), make('a', 's', true)); vault.add(note('b'), make('b')); const c = vault.add(note('c'), make('c', 'other', true)).source;
  await assert.rejects(records.removeMediaCard('s', ref), /先在对应镜头取消采用/);
  assert.ok((await records.requireRecord('b')).media?.length);
  a.source = make('a'); vault.failProcess = note('b');
  await assert.rejects(records.removeMediaCard('s', ref), /尚未全部移除/);
  assert.equal((await records.requireRecord('a')).media?.length, 0);
  vault.failProcess = ''; await records.removeMediaCard('s', ref);
  assert.equal(buildGraph(records.getSnapshot().records, 's').nodes.some(n => n.id === 'm:v'), false);
  assert.equal((await records.requireRecord('b')).links?.length, 0);
  assert.equal(vault.files.get(note('c'))!.source, c); assert.equal(vault.files.get(ref.path)!.source, 'video-bytes'); assert.equal(vault.bin.size, 0);
});

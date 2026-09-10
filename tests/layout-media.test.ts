import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vault } from 'obsidian';
import { VaultLayout, LAYOUT_PATH, parseLayout } from '../src/storage/vault-layout';
import { newRecord, parseRecord, patchMedia, patchRecord } from '../src/model';
import { Viewports } from '../src/canvas/viewports';
class LayoutVault {
  source = JSON.stringify({ version: 1, scenes: {}, custom: '保留' });
  fail = false;
  file = { path: LAYOUT_PATH, extension: 'json' };
  getAbstractFileByPath() { return this.file; }
  async read() { return this.source; }
  async process(_file: unknown, fn: (s: string) => string) { if (this.fail) throw new Error('模拟磁盘错误'); this.source = fn(this.source); return this.source; }
  port() { return this as unknown as Vault; }
}
test('两个视图各自保存视口，工作区恢复拒绝无效坐标', () => {
  const a = new Viewports(() => {}), b = new Viewports(() => {});
  a.update('scene', { x: 10, y: 20, k: .5 }); b.update('scene', { x: 90, y: 80, k: 2 });
  assert.equal(a.getSnapshot().scene!.k, .5);
  const reopened = new Viewports(() => {}); reopened.restore(a.getSnapshot());
  assert.deepEqual(reopened.getSnapshot(), a.getSnapshot());
  reopened.restore({ broken: { x: 0, y: 0, k: 0 }, valid: { x: 0, y: 0, k: 1 } });
  assert.deepEqual(Object.keys(reopened.getSnapshot()), ['valid']);
});
test('布局按记录 ID 保存，重新载入恢复视口与卡片；不包含镜头正文', async () => {
  const vault = new LayoutVault(), layout = new VaultLayout(vault.port()); await layout.refresh();
  layout.update('scene', { x: 120, y: -42, k: .75 }); layout.update('scene', { x: 500, y: 60 }, 'shot'); await layout.flush();
  const reopened = new VaultLayout(vault.port()); await reopened.refresh();
  assert.deepEqual(reopened.getSnapshot().data.scenes.scene, { viewport: { x: 120, y: -42, k: .75 }, positions: { shot: { x: 500, y: 60 } } });
  assert.equal(JSON.parse(vault.source).custom, '保留'); assert.ok(!vault.source.includes('body'));
  layout.dispose(); reopened.dispose();
});
test('布局写入合并最新文件中的其他镜头位置，写入失败保留待保存变化', async () => {
  const vault = new LayoutVault(), layout = new VaultLayout(vault.port()); await layout.refresh();
  layout.update('scene', { x: 10, y: 20 }, 'shot-a');
  vault.source = JSON.stringify({ version: 1, scenes: { scene: { viewport: { x: 0, y: 0, k: 1 }, positions: { 'shot-b': { x: 90, y: 80 } } } } });
  vault.fail = true; await assert.rejects(layout.flush()); assert.equal(layout.getSnapshot().status, 'error');
  vault.fail = false; await layout.flush();
  assert.deepEqual(parseLayout(vault.source).scenes.scene!.positions, { 'shot-a': { x: 10, y: 20 }, 'shot-b': { x: 90, y: 80 } }); layout.dispose();
});
test('损坏或未知版本布局不能被拖动保存覆盖', async () => {
  const vault = new LayoutVault(); vault.source = '{"version":999,"scenes":{}}'; const original = vault.source;
  const layout = new VaultLayout(vault.port()); await layout.refresh(); assert.equal(layout.getSnapshot().status, 'error');
  layout.update('scene', { x: 10, y: 10 }, 'shot'); await assert.rejects(layout.flush()); assert.equal(vault.source, original);
  assert.throws(() => parseLayout('{"version":1,"scenes":{"s":{"viewport":{"x":0,"y":0,"k":0},"positions":{}}}}'));
  layout.dispose();
});
test('素材关联保留正文、注释和未知属性；普通编辑不抹掉新素材', () => {
  const original = newRecord('shot', 'shot-a', '中性镜头', 'scene-a') + '原正文\n';
  const base = parseRecord(original, '镜头.md')!;
  const linked = patchMedia(original, 'shot-a', items => [...items, { id: 'm1', path: '素材/测试 #图.png' }]);
  const custom = linked.replace('path: 素材/测试 #图.png', 'path: 素材/测试 #图.png');
  const withUnknown = custom.replace('id: m1', 'id: m1\n      custom: 保留\n      # 素材注释');
  const renamed = patchMedia(withUnknown, 'shot-a', items => items.map(m => ({ ...m, path: '素材/新名字.png' })));
  const saved = patchRecord(renamed, base, { title: '修改标题', body: base.body });
  assert.ok(saved.includes('# 素材注释') && saved.includes('custom: 保留'));
  assert.equal(parseRecord(saved, '')!.body, base.body); assert.deepEqual(parseRecord(saved, '')!.media?.map(m => m.path), ['素材/新名字.png']);
});
test('拒绝重复素材编号、库外路径和错误身份；移除关联不改正文', () => {
  const source = newRecord('shot', 'a', '中性镜头', 's') + '正文';
  for (const path of ['../secret.png', '/tmp/image.png', 'https://example.com/x.png', '素材/../x.png', 'C:\\test.png']) assert.throws(() => patchMedia(source, 'a', () => [{ id: 'm', path }]));
  assert.throws(() => patchMedia(source, 'a', () => [{ id: 'm', path: 'a.png' }, { id: 'm', path: 'b.png' }]));
  assert.throws(() => patchMedia(source, 'wrong', () => []));
  const linked = patchMedia(source, 'a', () => [{ id: 'm', path: 'a.png' }]);
  assert.equal(parseRecord(patchMedia(linked, 'a', () => []), '')!.body, '正文');
});

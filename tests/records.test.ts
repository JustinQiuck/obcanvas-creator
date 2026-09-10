import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vault } from 'obsidian';
import { parseRecord, patchRecord, newRecord, ConflictError } from '../src/model';
import { VaultRecords } from '../src/storage/vault-records';
import { EditorSession } from '../src/editor-session';
const path = '影视项目/镜头.md';
const source = `---\n# 保留属性注释\ntags: [测试]\ncustom: 保留\nobcanvas:\n  version: 1\n  kind: shot\n  id: shot-a\n  sceneId: scene-a\n  title: 初始镜头\n  extra: 保留这个字段\n---\n原始正文\n\n## 自由备注\n保留段落。\n`;
const base = () => parseRecord(source, path)!;

test('只更新标题，保留 YAML 注释、未知字段与逐字正文', () => {
  const next = patchRecord(source, base(), { title: '修改标题', body: base().body });
  assert.equal(parseRecord(next, path)!.body, base().body);
  for (const text of ['# 保留属性注释', 'custom: 保留', 'extra: 保留这个字段']) assert.ok(next.includes(text));
  assert.match(next, /tags: \[ *测试 *\]/);
});
test('CRLF、BOM 与未变更的 YAML 原样保留', () => {
  const raw = '\uFEFF' + source.replace(/\n/g, '\r\n');
  const b = parseRecord(raw, path)!;
  const result = patchRecord(raw, b, { ...b, body: '新正文\r\n' });
  assert.equal(result.slice(0, result.indexOf('新正文')), raw.slice(0, raw.indexOf('原始正文')));
});
test('不同字段并发修改可合并，保留外部元数据', () => {
  const current = source.replace('title: 初始镜头', 'title: 外部标题').replace('custom: 保留', 'custom: 外部更新');
  const result = patchRecord(current, base(), { title: base().title, body: '我的正文' });
  assert.equal(parseRecord(result, path)!.title, '外部标题');
  assert.equal(parseRecord(result, path)!.body, '我的正文');
  assert.ok(result.includes('custom: 外部更新'));
});
test('同字段冲突拒绝覆盖；内容相同的并发修改可幂等保存', () => {
  const current = source.replace('title: 初始镜头', 'title: 其他标题');
  assert.throws(() => patchRecord(current, base(), { ...base(), title: '我的标题' }), ConflictError);
  assert.doesNotThrow(() => patchRecord(current, base(), { ...base(), title: '其他标题' }));
});
test('身份变化、损坏 YAML、未知版本和空标题均拒绝写入', () => {
  for (const value of [source.replace('id: shot-a', 'id: shot-b'), source.replace('sceneId: scene-a', 'sceneId: scene-b'), source.replace('version: 1', 'version: 9'), source.replace('tags: [测试]', 'tags: [未结束'), source.replace('---\n原始正文', '原始正文')]) {
    assert.throws(() => patchRecord(value, base(), { ...base(), title: '新标题' }));
  }
  assert.throws(() => patchRecord(source, base(), { ...base(), title: '  ' }));
  assert.equal(parseRecord('# 普通笔记', '普通.md'), null);
});
class MemoryVault {
  files = new Map<string, { path: string; source: string }>();
  failWrite = false;
  beforeProcess?: () => void;
  add(path: string, source: string) { const file = { path, source }; this.files.set(path, file); return file; }
  getMarkdownFiles() { return [...this.files.values()]; }
  async read(file: { source: string }) { return file.source; }
  async process(file: { source: string }, update: (value: string) => string) {
    this.beforeProcess?.();
    if (this.failWrite) throw new Error('模拟磁盘保存失败');
    file.source = update(file.source); return file.source;
  }
  port() { return this as unknown as Vault; }
}
async function setup() {
  const vault = new MemoryVault();
  const file = vault.add(path, source);
  const records = new VaultRecords(vault.port());
  await records.refresh();
  const editor = new EditorSession(records); editor.select('shot-a');
  return { vault, file, records, editor };
}
test('保存失败保留草稿、允许重试，成功后草稿清除', async () => {
  const { vault, file, records, editor } = await setup();
  editor.edit('body', '未保存内容'); vault.failWrite = true; await editor.save();
  assert.equal(editor.getSnapshot().status, 'error'); assert.equal(editor.getSnapshot().draft.body, '未保存内容');
  assert.equal(file.source, source); assert.ok(editor.recovery());
  vault.failWrite = false; await editor.save();
  assert.equal(parseRecord(file.source, path)!.body, '未保存内容');
  assert.equal(editor.recovery(), null);
  editor.dispose(); records.dispose();
});
test('两个会话同字段编辑产生冲突，重新载入需明确调用', async () => {
  const { records, editor: a } = await setup(); const b = new EditorSession(records); b.select('shot-a');
  a.edit('title', 'A 的修改'); b.edit('title', 'B 的修改'); await a.save(); await b.save();
  assert.equal(b.getSnapshot().status, 'conflict'); assert.equal(b.getSnapshot().draft.title, 'B 的修改');
  await b.loadLatest(); assert.equal(b.getSnapshot().draft.title, 'A 的修改'); assert.equal(b.recovery(), null);
  a.dispose(); b.dispose(); records.dispose();
});
test('保存前再次读取和 process 内检查覆盖扫描到写入间的竞争', async () => {
  const { vault, file, records, editor } = await setup(); editor.edit('title', '本地标题');
  vault.beforeProcess = () => { file.source = source.replace('title: 初始镜头', 'title: 最后时刻的修改'); };
  await editor.save(); assert.equal(editor.getSnapshot().status, 'conflict');
  assert.equal(parseRecord(file.source, path)!.title, '最后时刻的修改');
  editor.dispose(); records.dispose();
});
test('重命名按 ID 保存，删除和重复 ID 不会重建或覆盖文件', async () => {
  const { vault, file, records, editor } = await setup();
  vault.files.delete(path); file.path = '影视项目/改名.md'; vault.files.set(file.path, file); await records.refresh();
  assert.equal(editor.getSnapshot().base!.path, file.path);
  editor.edit('title', '改名后编辑'); await editor.save(); assert.equal(editor.getSnapshot().status, 'saved');
  vault.add('影视项目/副本.md', file.source); editor.edit('body', '不应写入'); await records.refresh(); await editor.save();
  assert.equal(records.getSnapshot().records.length, 0); assert.ok(records.getSnapshot().problems[0]!.includes('重复'));
  assert.ok(!file.source.includes('不应写入')); vault.files.clear(); await records.refresh(); await editor.save();
  assert.equal(vault.files.size, 0); assert.equal(editor.getSnapshot().draft.body, '不应写入');
  editor.dispose(); records.dispose();
});
test('会话卸载后不再接收更新，恢复草稿仍保留原始冲突基线', async () => {
  const { file, records, editor } = await setup();
  editor.edit('title', '恢复草稿'); const recovery = editor.recovery()!; let callbacks = 0;
  editor.subscribe(() => callbacks++); editor.dispose();
  file.source = source.replace('title: 初始镜头', 'title: 外部修改'); await records.refresh(); assert.equal(callbacks, 0);
  const reopened = new EditorSession(records, recovery); await reopened.save();
  assert.equal(reopened.getSnapshot().status, 'conflict'); assert.equal(reopened.getSnapshot().draft.title, '恢复草稿');
  reopened.dispose(); records.dispose();
});
test('场次与镜头记录共享版本和身份规则', () => {
  assert.equal(parseRecord(newRecord('scene', 'scene-a', '中性测试场次'), '场次.md')!.kind, 'scene');
  assert.equal(parseRecord(newRecord('shot', 'shot-a', '中性测试镜头', 'scene-a'), path)!.sceneId, 'scene-a');
});

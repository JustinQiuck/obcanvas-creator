import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vault } from 'obsidian';
import { newRecord, parseRecord, filmProjects, projectOf, projectRecords, LEGACY_PROJECT_ID, patchLinks, patchRecord, draftOf } from '../src/model';
import { VaultRecords } from '../src/storage/vault-records';
import { extractionContext, parseSuggestions } from '../src/ai/extraction-model';
import { storyboardContext } from '../src/ai/storyboard-model';
import { VaultSkills } from '../src/storage/vault-skills';
import { buildGraph } from '../src/canvas/graph';
import { LibraryNavigation } from '../src/library-navigation';

class MemoryVault {
  files = new Map<string, { path: string; extension: string; source: string }>(); folders = new Set(['影视项目']);
  getMarkdownFiles() { return [...this.files.values()].filter(f => f.extension === 'md'); }
  getAbstractFileByPath(path: string) { return this.files.get(path) ?? (this.folders.has(path) ? { path } : null); }
  async read(file: { source: string }) { return file.source; }
  async process(file: { source: string }, change: (raw: string) => string) { file.source = change(file.source); return file.source; }
  async create(path: string, source: string) { if (this.files.has(path)) throw new Error('文件已存在'); const file = { path, source, extension: path.split('.').pop()! }; this.files.set(path, file); return file; }
  async createFolder(path: string) { this.folders.add(path); }
  port() { return this as unknown as Vault; }
}
const record = (kind: Parameters<typeof newRecord>[0], id: string, scene?: string, project?: string) => parseRecord(newRecord(kind, id, id, scene, project), `${id}.md`)!;

test('旧记录只读归入原有剧本项目，改项目名不改原笔记、关系或布局', async () => {
  const vault = new MemoryVault(), records = new VaultRecords(vault.port());
  const raw = newRecord('scene', 'legacy-scene', '旧场次') + '逐字保留。';
  await vault.create('影视项目/旧.md', raw); await records.refresh();
  const project = filmProjects(records.getSnapshot().records)[0]!;
  assert.equal(project.id, LEGACY_PROJECT_ID); assert.equal(vault.files.size, 1);
  await records.nameProject(project, '已有影片');
  assert.equal(filmProjects(records.getSnapshot().records).length, 1);
  assert.equal(filmProjects(records.getSnapshot().records)[0]!.title, '已有影片');
  assert.equal(vault.files.get('影视项目/旧.md')!.source, raw);
});

test('资产直接归项目，无需创建场次；同项目跨场次复用同一身份', async () => {
  const vault = new MemoryVault(), records = new VaultRecords(vault.port());
  const project = await records.create('project', undefined, undefined, '影片甲');
  const asset = await records.create('person', undefined, project.id, '同一个角色');
  assert.equal(asset.sceneId, undefined); assert.equal(asset.projectId, project.id);
  for (let i = 0; i < 2; i++) {
    const scene = await records.create('scene', undefined, project.id), script = await records.create('script', scene.id);
    assert.equal(script.projectId, project.id);
    await records.attachScriptAsset(script, asset.id);
    assert.ok(buildGraph(records.getSnapshot().records, scene.id).nodes.some(n => n.record?.id === asset.id));
  }
  assert.equal(records.getSnapshot().records.filter(r => r.id === asset.id).length, 1);
  await records.refresh(); assert.deepEqual(records.getSnapshot().problems, []);
});

test('项目归属由数据层约束，拒绝跨项目引用、伪造场次和缺失项目', async () => {
  const vault = new MemoryVault(), records = new VaultRecords(vault.port());
  const a = await records.create('project'), b = await records.create('project');
  const scene = await records.create('scene', undefined, a.id), script = await records.create('script', scene.id);
  const asset = await records.create('person', undefined, b.id);
  await assert.rejects(records.attachScriptAsset(script, asset.id), /同一剧本项目/);
  await assert.rejects(records.editLinks(script.id, () => [{ id: 'bad-link', from: `r:${asset.id}`, role: '参考' }]), /当前剧本项目/);
  await assert.rejects(records.create('script', scene.id, b.id), /当前剧本项目/);
  await assert.rejects(records.create('person', undefined, 'missing'), /项目不存在/);
  const source = vault.files.get(script.path)!.source;
  assert.throws(() => patchRecord(source.replace(a.id, b.id), script, { ...draftOf(script), body: '改文' }), /剧本项目/);
  await assert.rejects(records.trashCard(a), /剧本项目包含/);
});

test('AI 上下文、同名复用和画布不会混入其他项目资产', () => {
  const sceneA = record('scene', 'sa', undefined, 'pa'), sceneB = record('scene', 'sb', undefined, 'pb');
  const script = { ...record('script', 'script', 'sa', 'pa'), body: '小林开门。' };
  const a = { ...record('person', 'a', undefined, 'pa'), title: '小林', body: '项目甲角色' };
  const b = { ...record('person', 'b', 'sb', 'pb'), title: '小林', body: '项目乙秘密' };
  const linked = { ...script, links: [{ id: 'la', from: 'r:a', role: '拍摄资产' as const }, { id: 'lb', from: 'r:b', role: '拍摄资产' as const }] };
  const all = [sceneA, sceneB, linked, a, b];
  assert.equal(projectOf(script, all), 'pa'); assert.equal(projectRecords(all, 'pa').length, 3);
  for (const context of [extractionContext(linked, all), storyboardContext(linked, all)]) { assert.ok(context.includes('项目甲角色')); assert.ok(!context.includes('项目乙秘密')); }
  const suggestion = { kind: 'person', title: '小林', evidence: '小林开门。', needs: ['主参考'] };
  assert.equal(parseSuggestions(JSON.stringify({ assets: [suggestion] }), script, all).items[0]!.targetId, 'a');
  assert.equal(parseSuggestions(JSON.stringify({ assets: [{ ...suggestion, existingId: 'b' }] }), script, all).items.length, 0);
  assert.ok(!buildGraph(all, 'sa').nodes.some(n => n.record?.id === 'b'));
});

test('每个项目默认 Skill 独立，旧默认、自定义与剧本覆盖继续可读', async () => {
  const vault = new MemoryVault();
  const builtins = ['normal', 'mv'].map(id => ({ id, name: id, stage: 'assets' as const, version: '1', instructions: '文字规则' }));
  const skills = new VaultSkills(vault.port(), builtins); await skills.refresh();
  await skills.choose('mv', undefined, 'pa');
  assert.equal(skills.resolve('script-a', 'pa').id, 'mv'); assert.equal(skills.resolve('script-b', 'pb').id, 'normal');
  await skills.choose('normal', 'script-a'); assert.equal(skills.resolve('script-a', 'pa').id, 'normal');
  const reopened = new VaultSkills(vault.port(), builtins); await reopened.refresh();
  assert.equal(reopened.resolve(undefined, 'pa').id, 'mv'); assert.equal(reopened.resolve(undefined, 'pb').id, 'normal');
});

test('项目工作区位置可恢复，各视图独立，异常状态不覆盖已选位置', () => {
  const first = new LibraryNavigation(() => {}), second = new LibraryNavigation(() => {});
  first.update({ projectId: 'pa', section: 'storyboard', scriptId: 's' });
  second.restore(first.getSnapshot()); assert.deepEqual(second.getSnapshot(), first.getSnapshot());
  second.restore({ projectId: 'pb', section: 'bad' }); assert.equal(second.getSnapshot().projectId, 'pa');
  second.update({ projectId: 'pb', section: 'assets' }); assert.equal(first.getSnapshot().projectId, 'pa');
});

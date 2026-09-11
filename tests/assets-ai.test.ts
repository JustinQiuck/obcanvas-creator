import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vault } from 'obsidian';
import { newRecord, parseRecord, patchMedia, patchLinks, patchAssetDetails, assetStatus, assetDetails, isRecovery, draftOf, patchRecord } from '../src/model';
import { buildGraph } from '../src/canvas/graph';
import { VaultRecords } from '../src/storage/vault-records';
import { VaultExtractions } from '../src/storage/vault-extractions';
import { parseSuggestions, parseTask } from '../src/ai/extraction-model';
import { ChatClient, chatEndpoint, readAISettings, type Transport } from '../src/ai/chat-client';
import { ExtractionService } from '../src/ai/extraction-service';

class MemoryVault {
  files = new Map<string, { path: string; extension: string; source: string }>();
  folders = new Set<string>(); failPath = ''; beforeProcess?: (path: string) => void;
  add(path: string, source: string) { const file = { path, source, extension: path.split('.').pop()! }; this.files.set(path, file); return file; }
  getFiles() { return [...this.files.values()]; }
  getMarkdownFiles() { return this.getFiles().filter(f => f.extension === 'md'); }
  getAbstractFileByPath(path: string) { return this.files.get(path) ?? (this.folders.has(path) ? { path } : null); }
  async read(file: { source: string }) { return file.source; }
  async process(file: { source: string; path: string }, edit: (raw: string) => string) {
    this.beforeProcess?.(file.path);
    if (file.path === this.failPath) throw new Error('模拟保存失败');
    file.source = edit(file.source); return file.source;
  }
  async create(path: string, source: string) { if (this.files.has(path)) throw new Error('文件已存在'); return this.add(path, source); }
  async createFolder(path: string) { this.folders.add(path); }
  port() { return this as unknown as Vault; }
}
const scriptRaw = newRecord('script', 'script', '中性剧本', 'scene-a') + '小林推开资料室的门，把蓝色文件袋放在桌上。';
const asset = { kind: 'person', title: '小林', description: '', evidence: '小林推开资料室的门', unresolved: ['服装待确认'], needs: ['主参考'], existingId: '' };
const answer = JSON.stringify({ assets: [asset, { ...asset, kind: 'prop', title: '文件袋', description: '蓝色文件袋', evidence: '蓝色文件袋', unresolved: [] }] });
const settings = { baseUrl: 'http://127.0.0.1:1234/v1', model: 'test' };
const transport: Transport = async () => ({ status: 200, text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: answer } }] }) });
async function setup(send: Transport = transport) {
  const vault = new MemoryVault(); vault.folders.add('影视项目');
  vault.add('影视项目/a.md', newRecord('scene', 'scene-a', '资料室'));
  vault.add('影视项目/b.md', newRecord('scene', 'scene-b', '走廊'));
  vault.add('影视项目/script.md', scriptRaw);
  const records = new VaultRecords(vault.port()), storage = new VaultExtractions(vault.port()); await records.refresh();
  const service = new ExtractionService(records, storage, new ChatClient(send), () => settings, () => '', { version: '1.0.0', instructions: '提取资产' });
  return { vault, records, storage, service };
}
test('道具与旧草稿兼容，跨场次引用同一资产不复制或改写已有记录', async () => {
  const { vault, records } = await setup();
  const person = newRecord('person', 'p', '小林', 'scene-a') + '外观已确认。';
  vault.add('影视项目/p.md', person);
  vault.add('影视项目/s2.md', newRecord('script', 's2', '第二段', 'scene-b') + '小林离开资料室。');
  await records.attachScriptAsset(await records.requireRecord('s2'), 'p');
  await records.attachScriptAsset(await records.requireRecord('s2'), 'p');
  const graph = buildGraph(records.getSnapshot().records, 'scene-b');
  assert.equal(graph.nodes.filter(n => n.record?.id === 'p').length, 1); assert.equal(graph.edges.length, 1);
  assert.equal(vault.files.get('影视项目/p.md')!.source, person);
  const p = await records.requireRecord('p'); await records.save(p, { ...draftOf(p), title: '林先生' });
  assert.equal(buildGraph(records.getSnapshot().records, 'scene-b').nodes.find(n => n.record?.id === 'p')!.title, '林先生');
  const prop = parseRecord(newRecord('prop', 'prop', '文件袋', 'scene-a'), 'p.md')!;
  assert.ok(isRecovery({ base: prop, draft: draftOf(prop) }));
  await assert.rejects(records.editLinks('s2', links => [...links, { id: 'bad', from: 'r:missing', role: '拍摄资产' }]));
});
test('资产参考用途与确认独立于导入，缺失和旧记录保持待处理', () => {
  let raw = newRecord('person', 'p', '小林', 'scene-a') + '正文';
  raw = patchMedia(raw, 'p', () => [{ id: 'image', path: '影视项目/参考.png' }]);
  const old = parseRecord(raw, '')!; assert.equal(assetStatus(old), '待检查参考图');
  raw = patchAssetDetails(raw, old, { needs: ['主参考'], unresolved: ['服装'] });
  assert.equal(assetStatus(parseRecord(raw, '')!), '待确认信息');
  raw = patchAssetDetails(raw, parseRecord(raw, '')!, { needs: ['主参考'], unresolved: [] });
  raw = patchMedia(raw, 'p', items => items.map(m => ({ ...m, purpose: '主参考', confirmed: true, fingerprint: '影视项目/参考.png:123:10' })));
  const confirmed = parseRecord(raw, '')!;
  assert.equal(assetStatus(confirmed), '已绑定参考图'); assert.equal(assetStatus(confirmed, () => false), '参考图需复核');
  assert.equal(parseRecord(patchRecord(raw, confirmed, { ...draftOf(confirmed), title: '改名' }), '')!.media![0]!.confirmed, true);
  assert.throws(() => patchAssetDetails(raw, old, { needs: [], unresolved: [] }));
  assert.deepEqual(assetDetails(old), { needs: ['主参考'], unresolved: [] });
});
test('提取结果校验原文依据、已有身份和未知信息；同名仅作为确认建议', () => {
  const script = parseRecord(scriptRaw, '')!;
  const existing = parseRecord(newRecord('person', 'p', '小林', 'scene-b'), '')!;
  const items = parseSuggestions(answer, script, [existing]);
  assert.equal(items[0]!.action, 'reuse'); assert.equal(items[0]!.targetId, 'p'); assert.deepEqual(items[0]!.unresolved, ['服装待确认']);
  assert.throws(() => parseSuggestions(JSON.stringify({ assets: [{ ...asset, evidence: '凭空出现的句子' }] }), script, []));
  assert.throws(() => parseSuggestions(JSON.stringify({ assets: [{ ...asset, existingId: 'missing' }] }), script, []));
  assert.deepEqual(parseSuggestions('{"assets":[]}', script, []), []);
});
test('通用接口地址与响应验证，不记录密钥或服务错误正文', async () => {
  assert.equal(chatEndpoint('https://example.com'), 'https://example.com/v1/chat/completions');
  assert.equal(chatEndpoint('https://example.com/api/v2/chat/completions/'), 'https://example.com/api/v2/chat/completions');
  assert.throws(() => chatEndpoint('https://example.com/v1?api_key=hidden')); assert.throws(() => chatEndpoint('https://user:secret@example.com'));
  assert.deepEqual(readAISettings(undefined), { baseUrl: '', model: '' });
  let count = 0;
  const client = new ChatClient(async request => { count++; assert.equal(request.headers.Authorization, 'Bearer hidden'); assert.equal(JSON.parse(request.body).stream, false); return { status: 401, text: 'hidden-secret-server-echo' }; });
  await assert.rejects(client.complete(settings, 'hidden', [{ role: 'user', content: '你好' }], new AbortController().signal), e => (e as Error).message === '密钥无效或已过期。');
  assert.equal(count, 1);
  const truncated = new ChatClient(async () => ({ status: 200, text: '{"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}' }));
  await assert.rejects(truncated.complete(settings, '', [], new AbortController().signal), /截断/);
});
test('提取不写正式资产；确认中途失败后重开重试不重复创建', async () => {
  const { vault, service, records, storage } = await setup(); const count = vault.getMarkdownFiles().length;
  await service.start('script', 'view'); const task = service.getSnapshot().tasks[0]!;
  assert.equal(vault.getMarkdownFiles().length, count); assert.equal(task.status, 'review');
  vault.failPath = '影视项目/script.md'; await assert.rejects(service.apply(task), /未全部完成/);
  assert.equal(vault.getMarkdownFiles().length, count + 1);
  vault.failPath = ''; const saved = (await storage.list())[0]!; assert.equal(saved.status, 'partial');
  await service.apply(saved); assert.equal(vault.getMarkdownFiles().length, count + 2);
  await service.apply(service.getSnapshot().tasks[0]!); assert.equal(vault.getMarkdownFiles().length, count + 2);
  assert.equal((await records.requireRecord('script')).links!.length, 2);
  assert.equal((await storage.list())[0]!.status, 'complete');
  service.dispose();
});
test('剧本在结果返回后更新时阻止应用，任务草稿原样保留', async () => {
  const { vault, service, records } = await setup(); await service.start('script', 'view');
  const task = service.getSnapshot().tasks[0]!, script = await records.requireRecord('script');
  await records.save(script, { ...draftOf(script), body: '新的故事。' });
  await assert.rejects(service.apply(task), /剧本已更新/);
  assert.equal(vault.getMarkdownFiles().length, 3); assert.equal(service.getSnapshot().tasks[0]!.status, 'review'); service.dispose();
});
test('清单修改自动保存格式与乐观冲突保护，不覆盖外部修改', async () => {
  const { service, storage } = await setup(); await service.start('script', 'view');
  const base = service.getSnapshot().tasks[0]!;
  service.editDraft(base, { ...base, items: base.items.map(i => ({ ...i, title: i.title + '确认', unresolved: [...i.unresolved, ''] })) });
  await service.flushDrafts(); const saved = service.getSnapshot().tasks[0]!;
  assert.equal(saved.items[0]!.title, '小林确认'); assert.ok(!saved.items[0]!.unresolved.includes(''));
  await assert.rejects(storage.save({ ...base, status: 'complete' }, base), /已被修改/);
  const invalid = { ...saved, id: '../unsafe' }; assert.throws(() => parseTask(JSON.stringify(invalid)));
  service.dispose();
});
test('取消和超时忽略迟到响应，双击不发第二次请求', async () => {
  let resolve!: (r: Awaited<ReturnType<Transport>>) => void; let count = 0;
  const { service, storage } = await setup(async () => { count++; return new Promise(r => { resolve = r; }); });
  const running = service.start('script', 'view');
  while (!count) await new Promise(r => setTimeout(r, 1));
  await assert.rejects(service.start('script', 'another'), /已有整理任务/);
  service.cancel('view'); await assert.rejects(running, /取消/);
  resolve(await transport({ url: '', method: '', headers: {}, body: '' }));
  await new Promise(r => setTimeout(r, 1)); assert.equal((await storage.list()).length, 0); assert.equal(count, 1); service.dispose();
  const stalled = new ChatClient(() => new Promise(() => {}));
  await assert.rejects(stalled.complete(settings, '', [], new AbortController().signal, 2), /超时/);
});

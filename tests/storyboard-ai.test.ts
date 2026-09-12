import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Vault } from 'obsidian';
import { newRecord, parseRecord, patchAssetDetails, patchLinks, patchMedia } from '../src/model';
import { ChatClient, type Transport } from '../src/ai/chat-client';
import { parseStoryboardSuggestions, parseStoryboardTask, storyboardContext, storyboardInputVersion } from '../src/ai/storyboard-model';
import { StoryboardService } from '../src/ai/storyboard-service';
import { storyboardPrompt, type StoryboardSkill } from '../src/ai/storyboard-skill';
import { VaultRecords } from '../src/storage/vault-records';
import { VaultStoryboards } from '../src/storage/vault-storyboards';

class MemoryVault {
  files = new Map<string, { path: string; extension: string; source: string }>();
  folders = new Set<string>();
  beforeProcess?: (path: string) => void;
  add(path: string, source: string) { const file = { path, source, extension: path.split('.').pop()! }; this.files.set(path, file); return file; }
  getFiles() { return [...this.files.values()]; }
  getMarkdownFiles() { return this.getFiles().filter(file => file.extension === 'md'); }
  getAbstractFileByPath(path: string) { return this.files.get(path) ?? (this.folders.has(path) ? { path } : null); }
  async read(file: { source: string }) { return file.source; }
  async process(file: { source: string; path: string }, edit: (raw: string) => string) { this.beforeProcess?.(file.path); file.source = edit(file.source); return file.source; }
  async create(path: string, source: string) { if (this.files.has(path)) throw new Error('文件已存在'); return this.add(path, source); }
  async createFolder(path: string) { this.folders.add(path); }
  port() { return this as unknown as Vault; }
}

const scriptText = '女人提着打包的饭走出地下停车场。她回到家，走到房门前敲门，叫房间里的男人吃饭。门内的声音停住了。';
const shot = {
  title: '停车场建立',
  evidence: '女人提着打包的饭走出地下停车场。',
  intent: '先建立她与家的距离，让观众知道逼近已经开始；用全景交代停车场出口与孤立感。',
  framing: '竖屏全景，人物位于纵深中景，出口留在背景上方。',
  camera: '低于视线的固定机位，不跟拍，让人物主动穿过空间。',
  start: '女人位于车道中景，身体朝向出口，右手提打包饭，双手和道路关系清楚。',
  action: '她从车道走向出口。',
  end: '她抵达出口附近，离家更近的行动线已经成立。',
  sound: '停车场环境声，脚步声和饭盒轻微碰撞声，无对白。',
  keyframePrompt: '竖屏 9:16 全景，低位平视固定机位，前景停车线，中景女人身体朝出口、右手提打包饭，背景为停车场出口，冷白顶灯，排除行走拖影与终点状态。',
  plannedDurationSeconds: 4,
};
const answer = JSON.stringify({ shots: [shot] });
const settings = { baseUrl: 'http://127.0.0.1:1234/v1', model: 'test-storyboard' };
const storyboardSkill: StoryboardSkill = { id: 'drama-storyboard-preview', name: '剧情分镜试点', stage: 'storyboard', version: 'test', instructions: '先说明镜头为什么存在。静态关键帧只描述起点。成片计划时长不是 MiniMax H3 的生成时长。' };
const ok: Transport = async () => ({ status: 200, text: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: answer } }] }) });

async function setup(send: Transport = ok) {
  const vault = new MemoryVault(); vault.folders.add('影视项目');
  vault.add('影视项目/scene.md', newRecord('scene', 'scene-a', '回家'));
  let person = newRecord('person', 'person-a', '女人', 'scene-a') + '成年人，回家时提着打包饭。';
  person = patchAssetDetails(person, parseRecord(person, '')!, { unresolved: ['外套颜色 TBD'], needs: ['主参考'] });
  person = patchMedia(person, 'person-a', () => [{ id: 'image-a', path: '影视项目/素材/secret-reference.png', purpose: '主参考', confirmed: true, fingerprint: 'hidden' }]);
  vault.add('影视项目/person.md', person);
  vault.add('影视项目/unlinked.md', newRecord('prop', 'prop-x', '未关联道具', 'scene-a') + '不应发送。');
  let script = newRecord('script', 'script-a', '回家段落', 'scene-a') + scriptText;
  script = patchLinks(script, 'script-a', () => [{ id: 'link-a', from: 'r:person-a', role: '拍摄资产' }]);
  vault.add('影视项目/script.md', script);
  const records = new VaultRecords(vault.port()), storage = new VaultStoryboards(vault.port()); await records.refresh();
  const service = new StoryboardService(records, storage, new ChatClient(send), () => settings, () => '', storyboardSkill);
  return { vault, records, storage, service };
}

test('分镜上下文只包含剧本已关联资产的文字与确认用途，不发送图片路径', async () => {
  const { records } = await setup();
  const script = await records.requireRecord('script-a'), all = records.getSnapshot().records;
  const context = storyboardContext(script, all), parsed = JSON.parse(context);
  assert.equal(parsed.assets.length, 1); assert.equal(parsed.assets[0].id, 'person-a');
  assert.deepEqual(parsed.assets[0].confirmedReferencePurposes, ['主参考']);
  assert.ok(!context.includes('secret-reference.png')); assert.ok(!context.includes('未关联道具'));
  const version = await storyboardInputVersion(script, all);
  const unlinkedChanged = all.map(record => record.id === 'prop-x' ? { ...record, body: '已改变但仍未关联' } : record);
  assert.equal(await storyboardInputVersion(script, unlinkedChanged), version);
  const linkedChanged = all.map(record => record.id === 'person-a' ? { ...record, body: '人物描述改变' } : record);
  assert.notEqual(await storyboardInputVersion(script, linkedChanged), version);
});

test('分镜逐项核对连续原文和完整拍摄字段，保留其他可用镜头', async () => {
  const { records } = await setup(); const script = await records.requireRecord('script-a');
  const result = parseStoryboardSuggestions(JSON.stringify({ shots: [shot, { ...shot, title: '错误原文', evidence: '她突然乘电梯。' }, { ...shot, title: '缺机位', camera: '' }] }), script);
  assert.equal(result.items.length, 1); assert.equal(result.items[0]!.evidence, shot.evidence);
  assert.match(result.issues[0]!, /第 2 镜「错误原文」.*原文依据/); assert.match(result.issues[1]!, /第 3 镜「缺机位」.*camera/);
  const formatted = parseStoryboardSuggestions('```JSON\n' + JSON.stringify({ shots: [{ ...shot, evidence: '女人提着打包的饭走出\n地下停车场。' }] }) + '\n```', script);
  assert.equal(formatted.items[0]!.evidence, shot.evidence);
  assert.throws(() => parseStoryboardSuggestions('{bad', script), /有效 JSON 分镜/);
});

test('分镜任务保存实际规则和完整协议快照，预览不创建正式镜头卡', async () => {
  let system = '';
  const { vault, records, storage, service } = await setup(async request => { system = JSON.parse(request.body).messages[0].content; return ok(request); });
  const before = vault.getMarkdownFiles().length;
  await service.start('script-a', 'view-a');
  const task = (await storage.list())[0]!;
  assert.equal(vault.getMarkdownFiles().length, before); assert.equal(records.getSnapshot().records.filter(record => record.kind === 'shot').length, 0);
  assert.equal(task.status, 'review'); assert.equal(task.skill.prompt, system); assert.ok(system.includes('为什么采用此景别与机位'));
  assert.equal(task.items.length, 1); assert.equal(task.items[0]!.plannedDurationSeconds, 4);
  assert.ok(parseStoryboardTask(JSON.stringify(task)));
  assert.throws(() => parseStoryboardTask(JSON.stringify({ ...task, skill: { ...task.skill, stage: 'assets' } })), /格式损坏/);
  service.dispose();
});

test('分镜预览修改自动保存并拒绝覆盖外部版本', async () => {
  const { service, storage } = await setup(); await service.start('script-a', 'view-a');
  const base = service.getSnapshot().tasks[0]!;
  service.editDraft(base, { ...base, items: base.items.map(item => ({ ...item, title: '  停车场出口  ', intent: '  交代逼近。  ' })) });
  await service.flushDrafts(); const saved = service.getSnapshot().tasks[0]!;
  assert.equal(saved.items[0]!.title, '停车场出口'); assert.equal(saved.items[0]!.intent, '交代逼近。');
  await assert.rejects(storage.save({ ...base, items: [] }, base), /已被修改/);
  service.dispose();
});

test('分镜取消忽略迟到响应，任务不会落盘', async () => {
  let resolve!: (value: Awaited<ReturnType<Transport>>) => void; let calls = 0;
  const { service, storage } = await setup(async () => { calls++; return new Promise(done => { resolve = done; }); });
  const running = service.start('script-a', 'view-a');
  while (!calls) await new Promise(done => setTimeout(done, 1));
  await assert.rejects(service.start('script-a', 'view-b'), /已有分镜任务/);
  service.cancel('view-a'); await assert.rejects(running, /取消/);
  resolve(await ok({ url: '', method: '', headers: {}, body: '' })); await new Promise(done => setTimeout(done, 1));
  assert.equal((await storage.list()).length, 0); service.dispose();
});

test('分镜规则协议明确静态首帧和编辑时长边界', () => {
  const prompt = storyboardPrompt(storyboardSkill);
  assert.ok(prompt.includes('keyframePrompt')); assert.ok(prompt.includes('只含 start 事实'));
  assert.ok(prompt.includes('成片计划时长')); assert.ok(prompt.includes('不是 MiniMax H3 的生成时长'));
  const packaged = readFileSync(new URL('../skills/drama-storyboard/SKILL.md', import.meta.url), 'utf8');
  assert.ok(packaged.includes('不展示性器官、裸露细节或行为过程')); assert.ok(packaged.includes('画外行为持续／停止'));
});

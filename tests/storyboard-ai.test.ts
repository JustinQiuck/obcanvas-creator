import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vault } from 'obsidian';
import { newRecord, parseRecord, patchAssetDetails, patchLinks, patchMedia, draftOf } from '../src/model';
import { ChatClient, type Transport } from '../src/ai/chat-client';
import { parseStoryboardSuggestions, parseStoryboardTask, storyboardContext, storyboardInputVersion } from '../src/ai/storyboard-model';
import { StoryboardService } from '../src/ai/storyboard-service';
import { storyboardPrompt, type StoryboardSkill } from '../src/ai/storyboard-skill';
import { VaultRecords } from '../src/storage/vault-records';
import { VaultStoryboards } from '../src/storage/vault-storyboards';
import { VaultStoryboardSettings, STORYBOARD_SETTINGS_PATH, parseStoryboardSettings } from '../src/storage/vault-storyboard-settings';

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
});

test('确认分镜入卡保留各拍摄字段、资产关系；重复确认不复制或覆盖已选视频', async () => {
  const { vault, service, records } = await setup(); await service.start('script-a', 'view');
  await service.apply(service.getSnapshot().tasks[0]!);
  const task = service.getSnapshot().tasks[0]!, target = task.application![0]!.shotId;
  assert.equal(task.status, 'complete');
  const formal = await records.requireRecord(target);
  assert.equal(formal.body, shot.action); assert.equal(formal.keyframePrompt, shot.keyframePrompt); assert.equal(formal.plannedDuration, '4');
  assert.equal(formal.start, shot.start); assert.equal(formal.end, shot.end); assert.equal(formal.sound, shot.sound);
  assert.ok(formal.links?.some(l => l.from === 'r:script-a')); assert.ok(formal.links?.some(l => l.from === 'r:person-a'));
  const file = vault.files.get(formal.path)!; file.source = patchMedia(file.source, target, () => [{ id: 'video', path: 'clip.mp4', decision: 'adopted' }]);
  const preserved = file.source; await service.apply(task);
  assert.equal(file.source, preserved); assert.equal(records.getSnapshot().records.filter(r => r.kind === 'shot').length, 1);
  assert.deepEqual((await records.requireRecord('scene-a')).shotOrder, [target]); service.dispose();
});

test('入卡顺序写入失败后恢复固定 ID，已写镜头的人工编辑不会被重试覆盖', async () => {
  const { vault, service, records, storage } = await setup(); await service.start('script-a', 'view');
  let fail = true; vault.beforeProcess = path => { if (fail && path.endsWith('scene.md')) { fail = false; throw new Error('模拟顺序保存失败'); } };
  await assert.rejects(service.apply(service.getSnapshot().tasks[0]!), /顺序保存失败/);
  const partial = service.getSnapshot().tasks[0]!; assert.equal(partial.status, 'partial');
  const id = partial.application![0]!.shotId, r = await records.requireRecord(id);
  await records.save(r, { ...draftOf(r), body: '人工保留的新动作' });
  service.dispose();
  const reopened = new StoryboardService(records, storage, new ChatClient(ok), () => settings, () => '', storyboardSkill); await reopened.refresh();
  await reopened.apply(reopened.getSnapshot().tasks[0]!);
  assert.equal((await records.requireRecord(id)).body, '人工保留的新动作');
  assert.equal(records.getSnapshot().records.filter(r => r.kind === 'shot').length, 1);
  assert.equal(reopened.getSnapshot().tasks[0]!.status, 'complete'); reopened.dispose();
});

test('入卡前再次检查剧本文字，检查后变更不能写入新镜头', async () => {
  const { service, records } = await setup(); await service.start('script-a', 'view');
  const task = service.getSnapshot().tasks[0]!, before = await records.requireRecord('script-a');
  await records.save(before, { ...draftOf(before), body: before.body + ' 内容已更新。' });
  await assert.rejects(records.ensureStoryboardShot(before, task.items[0]!, task.id, crypto.randomUUID(), false), /入卡检查后已更新/);
  assert.equal(records.getSnapshot().records.some(r => r.kind === 'shot'), false); service.dispose();
});

test('已保存的第一镜删除后，部分任务恢复不会重建它；保留后续已写内容', async () => {
  const two: Transport = async () => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shots: [shot, { ...shot, title: '第二镜' }] }) } }] }) });
  const { vault, service, records } = await setup(two); await service.start('script-a', 'view');
  let orders = 0; vault.beforeProcess = path => { if (path.endsWith('scene.md') && ++orders === 2) throw new Error('第二次排序失败'); };
  await assert.rejects(service.apply(service.getSnapshot().tasks[0]!), /排序失败/);
  const partial = service.getSnapshot().tasks[0]!, first = await records.requireRecord(partial.application![0]!.shotId);
  assert.equal(partial.application![0]!.applied, true); vault.files.delete(first.path); vault.beforeProcess = undefined;
  await assert.rejects(service.apply(partial), /不会从历史任务重新创建/);
  assert.equal(vault.files.has(first.path), false); service.dispose();
});

test('过期或缺镜预览不能入卡，冻结映射不能继续编辑或伪造完成', async () => {
  const { service, records } = await setup(); await service.start('script-a', 'view'); const task = service.getSnapshot().tasks[0]!;
  const script = await records.requireRecord('script-a'); await records.save(script, { title: script.title, body: script.body + ' 原文已变。' });
  await assert.rejects(service.apply(task), /剧本或关联资产已更新/);
  assert.equal(records.getSnapshot().records.some(r => r.kind === 'shot'), false);
  assert.throws(() => parseStoryboardTask(JSON.stringify({ ...task, status: 'complete' })), /应用进度/);
  assert.throws(() => service.editDraft({ ...task, status: 'partial' }, task), /已冻结/); service.dispose();
  const broken: Transport = async () => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shots: [shot, { ...shot, evidence: '非原文' }] }) } }] }) });
  const second = await setup(broken); await second.service.start('script-a', 'view');
  await assert.rejects(second.service.apply(second.service.getSnapshot().tasks[0]!), /未通过检查/); second.service.dispose();
});

test('分镜规则独立保存项目默认和剧本方向，MV 缺方法或音乐依据时阻止请求', async () => {
  const { vault } = await setup(); const prefs = new VaultStoryboardSettings(vault.port(), storyboardSkill); await prefs.refresh();
  assert.equal(vault.files.has(STORYBOARD_SETTINGS_PATH), false);
  const custom = await prefs.saveCustom('MV 长镜头', '按音乐时间点组织画面，不预设快节奏。');
  const choice = { skillId: custom.id, format: 'mv' as const, direction: '固定观察', musicTiming: '0–4 秒：前奏，建立空间。' };
  await prefs.saveChoice('script-a', 'legacy-project', choice, true);
  assert.equal(prefs.resolve('script-a', 'legacy-project').skill.id, custom.id);
  await prefs.saveChoice('script-a', 'legacy-project', { ...choice, musicTiming: '' });
  assert.throws(() => prefs.resolve('script-a', 'legacy-project'), /音乐 MV/);
  await prefs.saveChoice('script-a', 'legacy-project', choice, false, true);
  const reopened = new VaultStoryboardSettings(vault.port(), storyboardSkill); await reopened.refresh();
  assert.deepEqual(reopened.choice('script-a', 'legacy-project'), choice);
  assert.equal(reopened.choice('script-a', 'another-project').skillId, storyboardSkill.id);
  assert.throws(() => parseStoryboardSettings(JSON.stringify({ version: 1, projects: {}, scripts: {}, custom: [{ ...custom, stage: 'assets' }] })), /损坏/);
  prefs.dispose(); reopened.dispose();
});

test('分镜配置写入冲突与文件删除拒绝覆盖；任务保存启动时规则与方向快照', async () => {
  const { vault, records, storage } = await setup(); const prefs = new VaultStoryboardSettings(vault.port(), storyboardSkill); await prefs.refresh();
  const custom = await prefs.saveCustom('缓慢观察', '只用有明确理由的固定机位。');
  const choice = { skillId: custom.id, format: 'drama' as const, direction: '固定观察', musicTiming: '' };
  await prefs.saveChoice('script-a', 'legacy-project', choice);
  let release!: (r: Awaited<ReturnType<Transport>>) => void; let called = false;
  const service = new StoryboardService(records, storage, new ChatClient(async () => { called = true; return new Promise(done => { release = done; }); }), () => settings, () => '', storyboardSkill, prefs);
  const running = service.start('script-a', 'view');
  await prefs.saveChoice('script-a', 'legacy-project', { ...choice, direction: '快节奏' });
  while (!called) await new Promise(done => setTimeout(done, 1)); release(await ok({ url: '', method: '', headers: {}, body: '' })); await running;
  const task = service.getSnapshot().tasks[0]!; assert.equal(task.direction?.direction, '固定观察'); assert.equal(task.skill.id, custom.id); assert.ok(task.skill.prompt.includes('固定观察'));
  const stale = new VaultStoryboardSettings(vault.port(), storyboardSkill); await stale.refresh();
  await prefs.saveCustom('新的', '新规则'); await assert.rejects(stale.saveCustom('冲突', '冲突规则'), /其他窗口修改/);
  vault.files.delete(STORYBOARD_SETTINGS_PATH); await prefs.refresh(); assert.ok(prefs.getSnapshot().error.includes('已移除')); assert.equal(vault.files.has(STORYBOARD_SETTINGS_PATH), false);
  service.dispose(); prefs.dispose(); stale.dispose();
});

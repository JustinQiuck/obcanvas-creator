import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelProfiles, readModelConfig, legacyProfileId, type ModelConfig, type ModelProfile } from '../src/ai/model-profiles';
import { ChatClient, type Transport } from '../src/ai/chat-client';
import { ExtractionService } from '../src/ai/extraction-service';
import { StoryboardService } from '../src/ai/storyboard-service';
import { newRecord, parseRecord } from '../src/model';
import type { VaultRecords } from '../src/storage/vault-records';
import type { VaultExtractions } from '../src/storage/vault-extractions';
import type { VaultStoryboards } from '../src/storage/vault-storyboards';

const a: ModelProfile = { id: 'a', name: '日常整理', baseUrl: 'https://a.example/v1', model: 'model-a' };
const b: ModelProfile = { id: 'b', name: '分镜精修', baseUrl: 'https://b.example/v1', model: 'model-b' };
test('旧配置迁移保持服务地址和 legacy 密钥身份，新配置拒绝重复或悬空选择', () => {
  const old = readModelConfig(undefined, { baseUrl: a.baseUrl, model: a.model });
  assert.equal(old.selectedId, legacyProfileId); assert.equal(old.profiles[0]!.baseUrl, a.baseUrl);
  assert.deepEqual(readModelConfig(undefined), { profiles: [], selectedId: '' });
  assert.throws(() => readModelConfig({ profiles: [a, a], selectedId: 'a' }), /重复/);
  assert.throws(() => readModelConfig({ profiles: [a], selectedId: 'missing' }), /不存在/);
  assert.throws(() => readModelConfig(null), /格式无效/);
});
test('多配置新增编辑和选择独立持久化，密钥不会进入配置，失败保留原选择', async () => {
  let saved: ModelConfig | undefined, fail = false;
  const profiles = new ModelProfiles(readModelConfig(undefined), async next => { if (fail) throw new Error('磁盘失败'); saved = structuredClone(next); });
  await profiles.save({ ...a, secret: 'must-not-persist' } as ModelProfile);
  await profiles.save(b); assert.equal(profiles.selected()!.id, 'a');
  await profiles.select('b'); await profiles.save({ ...a, name: '改名' });
  assert.equal(profiles.selected()!.id, 'b'); assert.ok(!JSON.stringify(saved).includes('must-not-persist'));
  assert.equal(new ModelProfiles(readModelConfig(saved), async () => {}).selected()!.model, 'model-b');
  fail = true; await assert.rejects(profiles.select('a'), /磁盘失败/); assert.equal(profiles.selected()!.id, 'b');
});
for (const kind of ['assets', 'storyboard'] as const) test(`${kind} 启动时锁定地址、模型和密钥，下一次任务使用新选择`, async () => {
  const profiles = new ModelProfiles({ profiles: [a, b], selectedId: 'a' }, async () => {});
  let unlock!: () => void;
  const gate = new Promise<void>(done => { unlock = done; });
  const script = { ...parseRecord(newRecord('script', 's', '中性测试', 'scene'), 's.md')!, body: '小林开门。' };
  const records = { requireRecord: async () => { await gate; return script; }, refresh: async () => {}, getSnapshot: () => ({ records: [script], problems: [] }) } as unknown as VaultRecords;
  const requests: Parameters<Transport>[0][] = [];
  const client = new ChatClient(async request => { requests.push(request); return { status: 401, text: '' }; });
  const secrets = { a: 'key-a', b: 'key-b' };
  const getSecret = (settings: { model: string }) => settings.model === 'model-a' ? secrets.a : secrets.b;
  const service = kind === 'assets'
    ? new ExtractionService(records, {} as VaultExtractions, client, () => profiles.selected()!, getSecret, { version: '1', instructions: '提取资产' })
    : new StoryboardService(records, {} as VaultStoryboards, client, () => profiles.selected()!, getSecret, { id: 's', name: '分镜', stage: 'storyboard', version: '1', instructions: '分镜' });
  const pending = service.start('s', 'test'); await profiles.select('b'); secrets.a = 'changed-key'; unlock();
  await assert.rejects(pending, /密钥无效/);
  assert.equal(requests[0]!.url, 'https://a.example/v1/chat/completions'); assert.equal(JSON.parse(requests[0]!.body).model, 'model-a'); assert.equal(requests[0]!.headers.Authorization, 'Bearer key-a');
  await assert.rejects(service.start('s', 'test'), /密钥无效/);
  assert.equal(requests[1]!.url, 'https://b.example/v1/chat/completions'); assert.equal(JSON.parse(requests[1]!.body).model, 'model-b'); assert.equal(requests[1]!.headers.Authorization, 'Bearer key-b');
  service.dispose();
});

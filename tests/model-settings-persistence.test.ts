import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('插件配置保存隔离密钥、继承旧密钥，草稿并发保存不覆盖模型选择', async () => {
  const bundle = await build({ entryPoints: ['src/main.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['obsidian'], loader: { '.md': 'text' }, logLevel: 'silent' });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundle.outputFiles[0]!.text)(() => ({ FuzzySuggestModal: class {}, Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, Notice: class {} }), module, module.exports);
  const Plugin = module.exports.default, plugin = new Plugin();
  const secrets = new Map([['obcanvas-creator-text-model', 'legacy-test-key']]);
  let saved: any, fail = false;
  plugin.app = { secretStorage: { getSecret: (id: string) => secrets.get(id), setSecret: (id: string, key: string) => secrets.set(id, key) } };
  plugin.saveData = async (data: unknown) => { if (fail) throw new Error('保存失败'); saved = structuredClone(data); };
  // Use the production settings initialization and serialized save path without loading UI.
  const { ModelProfiles, readModelConfig } = await import('../src/ai/model-profiles');
  plugin.models = new ModelProfiles(readModelConfig(undefined, { baseUrl: 'https://a.example/v1', model: 'old-model' }), next => plugin.flushDrafts(next));
  assert.equal(plugin.getAISecret(), 'legacy-test-key');
  const b = { id: 'b', name: '第二组', baseUrl: 'https://b.example/v1', model: 'new-model' };
  await plugin.saveModelProfile(b, 'b-test-key');
  assert.equal(plugin.getAISecret('legacy'), 'legacy-test-key'); assert.equal(plugin.getAISecret('b'), 'b-test-key');
  await Promise.all([plugin.models.select('b'), plugin.flushDrafts()]);
  assert.equal(saved.models.selectedId, 'b'); assert.equal(saved.ai.model, 'new-model');
  assert.ok(!JSON.stringify(saved).includes('test-key'));
  await plugin.saveModelProfile({ ...b, name: '改名' }); assert.equal(plugin.getAISecret('b'), 'b-test-key');
  fail = true;
  await assert.rejects(plugin.saveModelProfile({ ...b, model: 'bad-save' }, 'replacement-test-key'), /保存失败/);
  assert.equal(plugin.getAISecret('b'), 'b-test-key'); assert.equal(plugin.aiSettings.model, 'new-model');
  const restored = new ModelProfiles(readModelConfig(saved.models), async () => {}); assert.equal(restored.selected()!.model, 'new-model');
});

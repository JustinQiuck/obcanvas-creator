import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Vault } from 'obsidian';
import { VaultSkills, SKILLS_PATH } from '../src/storage/vault-skills';
import { importSkillMarkdown, exportSkillMarkdown, parseSkillConfig, skillPrompt, type AssetSkill } from '../src/ai/skill-model';
const builtins: AssetSkill[] = [{ id: 'general', name: '通用', stage: 'assets', version: '1', instructions: '按叙事用途提取。' }, { id: 'mv', name: 'MV', stage: 'assets', version: '1', instructions: '区分演出与视觉意象。' }];
class SkillVault {
  file?: { extension: string; source: string }; fail = false;
  getAbstractFileByPath(path: string) { return path === SKILLS_PATH ? this.file ?? null : {}; }
  async read(file: { source: string }) { return file.source; }
  async process(file: { source: string }, edit: (s: string) => string) { if (this.fail) throw new Error('写入失败'); return file.source = edit(file.source); }
  async create(_path: string, source: string) { if (this.file) throw new Error('已存在'); return this.file = { extension: 'json', source }; }
  port() { return this as unknown as Vault; }
}
test('项目默认与剧本覆盖独立持久化，旧库不会因载入而创建配置', async () => {
  const vault = new SkillVault(), store = new VaultSkills(vault.port(), builtins); await store.refresh();
  assert.equal(vault.file, undefined); assert.equal(store.resolve('s').id, 'general');
  await store.choose('mv'); await store.choose('general', 's');
  const reopened = new VaultSkills(vault.port(), builtins); await reopened.refresh();
  assert.equal(reopened.resolve('another').id, 'mv'); assert.equal(reopened.resolve('s').id, 'general');
  await reopened.choose('', 's'); assert.equal(reopened.resolve('s').id, 'mv');
  await reopened.choose('mv', '__proto__'); assert.equal(Object.getPrototypeOf(reopened.getSnapshot().config.scripts), Object.prototype);
});
test('自定义版本变更不修改已取得快照，内置 Skill 不可覆盖，外部冲突与写入失败不覆盖', async () => {
  const vault = new SkillVault(), store = new VaultSkills(vault.port(), builtins); await store.refresh();
  const created = await store.saveCustom('我的规则', '只提取反复出现的道具。'); await store.choose(created.id, 's');
  const captured = store.resolve('s'); const updated = await store.saveCustom('新规则', '优先检查演出空间。', created);
  assert.notEqual(updated.version, captured.version); assert.equal(captured.instructions, '只提取反复出现的道具。');
  await assert.rejects(store.saveCustom('覆盖', '覆盖规则', builtins[0]), /内置规则/);
  const other = new VaultSkills(vault.port(), builtins); await other.refresh(); await other.choose('mv');
  const external = vault.file!.source; await assert.rejects(store.choose('general'), /其他窗口修改/); assert.equal(vault.file!.source, external);
  await store.refresh(); vault.fail = true; await assert.rejects(store.choose('general'), /写入失败/); assert.equal(vault.file!.source, external);
});
test('损坏配置、缺失 Skill 与配置文件丢失均显示错误而非静默换用默认', async () => {
  const vault = new SkillVault(), store = new VaultSkills(vault.port(), builtins); await store.refresh(); await store.choose('mv');
  const config = parseSkillConfig(vault.file!.source); config.defaultAssetSkillId = 'missing'; vault.file!.source = JSON.stringify(config); await store.refresh();
  assert.throws(() => store.resolve(), /已不存在/); await store.choose('general');
  vault.file!.source = '{bad'; await store.refresh(); assert.throws(() => store.resolve()); await assert.rejects(store.choose('mv'));
  vault.file!.source = JSON.stringify(config); await store.refresh(); vault.file = undefined; await store.refresh(); assert.throws(() => store.resolve(), /配置文件已移除/);
});
test('Markdown 导入导出可往返，只接受本阶段文字规则，输出协议由宿主提供', () => {
  const md = exportSkillMarkdown({ ...builtins[1]!, name: '我的 MV 资产' });
  assert.deepEqual(importSkillMarkdown(md, '规则.md'), { name: '我的 MV 资产', instructions: builtins[1]!.instructions });
  assert.equal(importSkillMarkdown('# 只提取道具', '道具.md').name, '道具');
  assert.throws(() => importSkillMarkdown('---\nstage: storyboard\n---\n设计分镜', '分镜.md'), /其他制作阶段/);
  assert.throws(() => importSkillMarkdown(' ', '空.md')); assert.throws(() => importSkillMarkdown('x'.repeat(30001), '长.md'));
  const prompt = skillPrompt(builtins[1]!); assert.ok(prompt.includes(builtins[1]!.instructions)); assert.ok(prompt.includes('"assets"')); assert.ok(prompt.includes('不设计分镜'));
});

import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const vault = resolve('.local/test-vault'), checks = [], calls = [];
const scriptText = '小林推开资料室的门，把蓝色文件袋放在桌上。';
let personId = '', server, page, mode = 'ok';
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347');
try {
  for (const candidate of browser.contexts().flatMap(c => c.pages())) if (await candidate.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => '') === vault) { page = candidate; break; }
  assert.ok(page, '必须匹配隔离测试资料库'); page.setDefaultTimeout(12000);
  await page.waitForFunction(() => app.workspace.layoutReady && !!app.plugins.plugins['obcanvas-creator']?.extractions);
  await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
  const root = page.locator('.obcanvas-free').first(); await root.waitFor();
  const btn = name => root.getByRole('button', { name, exact: true });
  async function check(name, fn) { await fn(); checks.push(name); console.log('通过：' + name); }
  const idle = () => page.waitForFunction(() => !document.querySelector('.obcanvas-free-tools button')?.disabled && !app.plugins.plugins['obcanvas-creator'].extractions.getSnapshot().busy);
  const record = id => page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.requireRecord(id), id);
  const current = () => page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().selectedId);
  const close = async () => { await btn('关闭详情').click(); await root.getByRole('complementary', { name: '卡片详情' }).waitFor({ state: 'hidden' }); await idle(); };
  const choose = async id => { await btn('总览').click(); await root.locator(`[data-node-id="r:${id}"]`).click(); await root.getByRole('complementary', { name: '卡片详情' }).waitFor(); await idle(); };
  if (process.argv.includes('--reopen')) {
    const s = JSON.parse(await readFile('.local/a-assets-checkpoint.json', 'utf8'));
    await check('完整重启后恢复模型配置、确认草稿、跨场次引用与图片用途', async () => {
      const stored = await page.evaluate(() => { const p = app.plugins.plugins['obcanvas-creator']; return { ai: p.aiSettings, secret: p.getAISecret() === 'obcanvas-neutral-test-key', tasks: p.extractions.getSnapshot().tasks }; });
      assert.deepEqual(stored.ai, s.ai); assert.equal(stored.secret, true);
      assert.equal(stored.tasks.find(t => t.id === s.taskId).status, 'complete');
      for (const r of s.records) assert.deepEqual(await record(r.id), r);
      await root.getByLabel('当前场次', { exact: true }).selectOption(s.secondScene); await idle();
      assert.equal(await root.locator(`[data-node-id="r:${s.person}"]`).count(), 1);
      await choose(s.person); assert.ok(await root.getByText('已确认使用', { exact: true }).isVisible());
    });
    await check('确认清单可直接定位到资产参考图绑定', async () => {
      await close(); await root.getByLabel('当前场次', { exact: true }).selectOption(s.scene); await idle(); await choose(s.script);
      await btn('绑定参考图 · 林先生').click(); await idle(); assert.equal(await current(), s.person);
      await root.getByRole('heading', { name: '绑定参考图', exact: true }).waitFor();
    });
  } else {
    const before = await page.evaluate(async () => { const p = app.plugins.plugins['obcanvas-creator']; return { notes: await Promise.all(p.records.getSnapshot().records.map(async r => [r.path, await app.vault.read(app.vault.getFileByPath(r.path))])), drafts: (await p.loadData()).drafts }; });
    const s = await page.evaluate(async () => {
      const p = app.plugins.plugins['obcanvas-creator'];
      const scene = await p.records.create('scene'); await p.records.save(scene, { title: 'A · 资产测试', body: '' });
      const prior = await p.records.create('scene'); await p.records.save(prior, { title: 'A · 既有场次', body: '' });
      const person = await p.records.create('person', prior.id); await p.records.save(person, { title: '小林', body: '用户已确认的角色外观。' });
      return { scene: scene.id, person: person.id, secondScene: prior.id };
    }); personId = s.person;
    server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push({ url: req.url, body, authorized: req.headers.authorization === 'Bearer obcanvas-neutral-test-key' });
      if (mode === 'unauthorized') { res.writeHead(401); res.end('{"error":"synthetic failure"}'); return; }
      const isAnalysis = body.messages.some(m => m.role === 'system');
      const content = isAnalysis ? JSON.stringify({ assets: [
        { kind: 'person', title: '小林', description: '', evidence: '小林推开资料室的门', unresolved: [], needs: ['主参考'], existingId: personId },
        { kind: 'setting', title: '资料室', description: '有门和桌子。', evidence: '资料室的门', unresolved: ['空间布局待确认'], needs: ['空间全景'], existingId: '' },
        { kind: 'prop', title: '文件袋', description: '蓝色文件袋。', evidence: '蓝色文件袋', unresolved: [], needs: ['主参考'], existingId: '' },
      ] }) : '连接成功。';
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${server.address().port}/v1`;
    await check('中文设置页保存通用接口并发起中性连接测试，草稿保留', async () => {
      await page.evaluate(() => { app.setting.open(); app.setting.openTabById('obcanvas-creator'); });
      let settingsPage = browser.contexts().flatMap(c => c.pages()).find(p => p !== page);
      if (!settingsPage) settingsPage = await page.context().waitForEvent('page');
      await settingsPage.getByRole('heading', { name: 'AI 助手', exact: true }).waitFor();
      await settingsPage.locator('.setting-item').filter({ hasText: '服务地址' }).locator('input').fill(url);
      await settingsPage.locator('.setting-item').filter({ hasText: '模型名称' }).locator('input').fill('neutral-compatible-model');
      await settingsPage.locator('.setting-item').filter({ hasText: 'API 密钥' }).locator('input').fill('obcanvas-neutral-test-key');
      await settingsPage.getByRole('button', { name: '保存配置', exact: true }).click();
      await settingsPage.getByRole('button', { name: '测试连接', exact: true }).click();
      await settingsPage.getByText('连接成功，已收到文字响应；资产提取效果需在剧本中检验。', { exact: true }).waitFor();
      assert.equal(calls.length, 1); assert.equal(calls[0].url, '/v1/chat/completions'); assert.equal(calls[0].authorized, true); assert.ok(!JSON.stringify(calls[0].body).includes(scriptText));
      const saved = await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].loadData());
      assert.deepEqual(saved.drafts, before.drafts); assert.ok(!JSON.stringify(saved).includes('obcanvas-neutral-test-key'));
      await page.evaluate(() => app.setting.close());
    });
    await root.getByLabel('当前场次', { exact: true }).selectOption(s.scene); await idle();
    await check('从剧本触发内置 Skill，先保存待确认清单，尚不创建资产', async () => {
      await btn('＋ 剧本').click(); await idle(); s.script = await current();
      await root.getByLabel('卡片标题', { exact: true }).fill('资产测试剧本');
      await root.getByLabel('卡片内容', { exact: true }).fill(scriptText);
      const count = await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.length);
      await btn('整理拍摄资产').click();
      await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].extractions.getSnapshot().tasks.some(t => t.scriptId === id), s.script); await idle();
      assert.equal(await root.getByLabel('资产名称', { exact: true }).count(), 3);
      assert.equal(await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.length), count);
      assert.ok(calls[1].body.messages[0].content.includes('production-asset-extractor'));
      const context = JSON.parse(calls[1].body.messages[1].content); assert.equal(context.script.text, scriptText); assert.ok(context.existing.some(r => r.id === s.person));
    });
    await check('清单改名自动保存，确认复用角色并创建场景和道具', async () => {
      await root.getByLabel('资产名称', { exact: true }).nth(2).fill('蓝色文件袋');
      await btn('保存清单修改').click(); await idle(); await btn('确认并生成资产卡').click(); await idle();
      const task = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].extractions.getSnapshot().tasks.find(t => t.scriptId === id), s.script);
      assert.equal(task.status, 'complete'); s.taskId = task.id; s.prop = task.items[2].targetId; s.setting = task.items[1].targetId;
      assert.equal((await record(s.script)).links.filter(l => l.role === '拍摄资产').length, 3);
      assert.equal((await record(s.prop)).kind, 'prop'); assert.equal((await record(s.prop)).title, '蓝色文件袋');
      assert.equal((await record(s.person)).body, '用户已确认的角色外观。');
      assert.equal(await root.locator(`[data-node-id="r:${s.person}"]`).count(), 1); await close();
    });
    await check('参考图导入与用户确认分开，绑定用途后消除资产待办', async () => {
      await choose(s.person); await root.getByLabel('复制文件到资料库', { exact: true }).setInputFiles(resolve('.local/media-fixtures/参考图.png'));
      await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id)?.media?.length === 1, s.person);
      assert.ok(await root.getByText('待检查参考图', { exact: true }).last().isVisible());
      await root.getByLabel('图片参考用途', { exact: true }).selectOption('主参考');
      await btn('确认使用此图').click(); await root.getByText('已确认使用', { exact: true }).waitFor();
      s.image = (await record(s.person)).media[0]; assert.equal(s.image.confirmed, true); assert.equal(s.image.purpose, '主参考'); await close();
      await btn('查看待办').click(); assert.equal(await root.locator('.obcanvas-task').filter({ hasText: '小林' }).count(), 0); assert.equal(await root.locator('.obcanvas-task').filter({ hasText: '资料室' }).count(), 1); await close();
    });
    await check('第二场次复用同一资产，改名后身份与引用保持一致', async () => {
      await root.getByLabel('当前场次', { exact: true }).selectOption(s.secondScene); await idle();
      await btn('＋ 剧本').click(); await idle(); s.script2 = await current();
      await root.getByLabel('卡片标题', { exact: true }).fill('第二段'); await root.getByLabel('卡片内容', { exact: true }).fill('小林回到走廊。');
      await root.getByText('关联已有拍摄资产（可跨场次复用）', { exact: true }).click(); await root.getByLabel('已有拍摄资产', { exact: true }).selectOption(s.person); await btn('关联到剧本').click(); await idle(); await close();
      await choose(s.person); await root.getByLabel('卡片标题', { exact: true }).fill('林先生'); await close();
      assert.equal((await record(s.script)).links.find(l => l.from === `r:${s.person}`).role, '拍摄资产');
      const same = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.filter(r => r.id === id).length, s.person); assert.equal(same, 1);
    });
    await check('图片改名保持引用，文件内容变化后要求重新确认', async () => {
      const old = (await record(s.person)).media[0];
      const renamed = old.path.replace(/\.png$/, '-rename.png');
      await page.evaluate(async ([from, to]) => { await app.vault.rename(app.vault.getFileByPath(from), to); }, [old.path, renamed]);
      await page.waitForFunction(([id, path]) => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id)?.media?.[0]?.path === path, [s.person, renamed]);
      await page.evaluate(async path => { const file = app.vault.getFileByPath(path); const bytes = await app.vault.readBinary(file); await app.vault.modifyBinary(file, bytes); }, renamed);
      await page.waitForFunction(id => { const p = app.plugins.plugins['obcanvas-creator']; return !p.media.referenceReady(p.records.getSnapshot().records.find(r => r.id === id).media[0]); }, s.person);
      await choose(s.person); await root.getByText('参考图需复核', { exact: true }).last().waitFor();
      await btn('确认使用此图').click(); await root.getByText('已确认使用', { exact: true }).waitFor(); await close();
    });
    await check('认证失败中文反馈，未生成新任务或改写剧本', async () => {
      mode = 'unauthorized'; await choose(s.script2); await btn('整理拍摄资产').click();
      await root.getByText('密钥无效或已过期。', { exact: true }).waitFor(); await idle();
      assert.equal(await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].extractions.getSnapshot().tasks.some(t => t.scriptId === id), s.script2), false); await close();
    });
    await check('测试前的所有项目笔记与采用记录逐字保持原样', async () => {
      for (const [path, raw] of before.notes) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
    });
    s.records = []; for (const id of [s.scene, s.secondScene, s.script, s.script2, s.person, s.setting, s.prop]) s.records.push(await record(id));
    s.ai = await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].aiSettings);
    await page.evaluate(async () => { const p = app.plugins.plugins['obcanvas-creator']; await p.extractions.flushDrafts(); await p.flushDrafts(); await p.layout.flush(); });
    await writeFile('.local/a-assets-checkpoint.json', JSON.stringify(s, null, 2));
  }
  await btn('总览').click(); await page.screenshot({ path: '.local/a-assets.png' });
  await writeFile('.local/a-assets-results' + (process.argv.includes('--reopen') ? '-reopen' : '') + '.json', JSON.stringify({ checks, simulatedInterface: true }, null, 2));
} catch (e) {
  if (page) { await page.screenshot({ path: '.local/a-assets-error.png' }).catch(() => {}); await writeFile('.local/a-assets-error.txt', await page.locator('body').innerText()).catch(() => {}); }
  throw e;
} finally { if (server) await new Promise(r => server.close(r)); await browser.close(); }

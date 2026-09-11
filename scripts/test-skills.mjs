import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const vault = resolve('.local/test-vault'), checks = [], requests = [];
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347'); let server;
try {
  let page;
  for (const p of browser.contexts().flatMap(c => c.pages())) if (await p.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => '') === vault) { page = p; break; }
  assert.ok(page, '只操作隔离资料库'); page.setDefaultTimeout(12000);
  await page.waitForFunction(() => app.workspace.layoutReady && !!app.plugins.plugins['obcanvas-creator']?.skills && !app.plugins.plugins['obcanvas-creator'].skills.getSnapshot().loading);
  await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
  const root = page.locator('.obcanvas-free').first(), dialog = root.getByRole('dialog', { name: '管理资产 Skill' });
  const btn = name => root.getByRole('button', { name, exact: true });
  const idle = () => page.waitForFunction(() => { const p = app.plugins.plugins['obcanvas-creator']; return !p.extractions.getSnapshot().busy && !p.skills.getSnapshot().busy && !document.querySelector('.obcanvas-free-tools button')?.disabled; });
  const choose = async id => { await btn('总览').click(); await root.locator(`[data-node-id="r:${id}"]`).click(); await idle(); };
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('通过：' + name); };
  if (process.argv.includes('--reopen')) {
    const s = JSON.parse(await readFile('.local/skills-checkpoint.json', 'utf8'));
    await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].extractions.getSnapshot().tasks.some(t => t.id === id), s.task.id);
    await check('重启后项目默认、剧本覆盖、自定义规则和历史任务快照恢复', async () => {
      const actual = await page.evaluate(() => { const p = app.plugins.plugins['obcanvas-creator']; return { config: p.skills.getSnapshot().config, tasks: p.extractions.getSnapshot().tasks }; });
      assert.deepEqual(actual.config, s.config); assert.deepEqual(actual.tasks.find(t => t.id === s.task.id), s.task);
      await root.getByLabel('当前场次', { exact: true }).selectOption(s.scene); await choose(s.script);
      assert.equal(await root.getByLabel('资产整理 Skill', { exact: true }).inputValue(), s.skillId);
      await root.getByText('本清单使用：测试演出资产', { exact: true }).waitFor();
      for (const [path, raw] of s.notes) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
    });
  } else {
    const notes = await page.evaluate(async () => { const p = app.plugins.plugins['obcanvas-creator']; return Promise.all(p.records.getSnapshot().records.map(async r => [r.path, await app.vault.read(app.vault.getFileByPath(r.path))])); });
    server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ assets: [{ kind: 'person', title: '小林', description: '在演出空间唱歌。', evidence: '小林在资料室唱歌', unresolved: [], needs: ['演出妆造'], existingId: '' }] }) } }] }));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const s = await page.evaluate(async url => {
      const p = app.plugins.plugins['obcanvas-creator']; await p.saveAISettings({ baseUrl: url, model: 'neutral-compatible-model' });
      const scene = await p.records.create('scene'), script = await p.records.create('script', scene.id), script2 = await p.records.create('script', scene.id);
      await p.records.save(script, { title: 'Skill 测试', body: '小林在资料室唱歌，手里拿着蓝色文件袋。' });
      return { scene: scene.id, script: script.id, script2: script2.id };
    }, `http://127.0.0.1:${server.address().port}/v1`);
    await root.getByLabel('当前场次', { exact: true }).selectOption(s.scene); await choose(s.script);
    await check('选择 MV Skill 后，请求实际包含 MV 规则，结果记录所用规则', async () => {
      await root.getByLabel('资产整理 Skill', { exact: true }).selectOption('mv-asset-extractor'); await idle(); await btn('整理拍摄资产').click();
      await root.getByText('本清单使用：音乐 MV 资产', { exact: true }).waitFor(); await idle();
      assert.ok(requests[0].messages[0].content.includes('歌词里的比喻不自动等于画面实物'));
      assert.ok(requests[0].messages[0].content.includes('"assets"'));
    });
    await check('复制内置规则为自定义，保存并选择，再提取使用新规则', async () => {
      await btn('管理 Skill').click(); await dialog.waitFor(); assert.equal(await dialog.getByLabel('Skill 规则正文').getAttribute('readonly'), '');
      await dialog.getByRole('button', { name: '复制为自定义', exact: true }).click();
      await dialog.getByLabel('Skill 名称', { exact: true }).fill('测试演出资产');
      await dialog.getByLabel('Skill 规则正文', { exact: true }).fill('先核对演出空间，再核对角色妆造；标记测试规则甲。');
      await dialog.getByRole('button', { name: '保存并用于此剧本', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await idle();
      s.skillId = await root.getByLabel('资产整理 Skill', { exact: true }).inputValue(); assert.ok(s.skillId.startsWith('custom-'));
      await btn('重新提取拍摄资产').click(); await root.getByText('本清单使用：测试演出资产', { exact: true }).waitFor(); await idle();
      assert.ok(requests[1].messages[0].content.includes('标记测试规则甲'));
      s.task = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].extractions.getSnapshot().tasks.find(t => t.scriptId === id), s.script);
    });
    await check('项目默认与当前剧本覆盖独立，修改规则不触发模型或修改旧清单', async () => {
      await btn('管理 Skill').click(); await dialog.waitFor();
      await dialog.getByLabel('项目默认 Skill', { exact: true }).selectOption('mv-asset-extractor'); await idle();
      await dialog.getByLabel('Skill 规则正文', { exact: true }).fill('先核对视觉意象；标记测试规则乙。');
      await dialog.getByRole('button', { name: '保存并用于此剧本', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await idle();
      assert.equal(requests.length, 2);
      const task = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].extractions.getSnapshot().tasks.find(t => t.id === id), s.task.id); assert.deepEqual(task, s.task);
      await root.getByText('当前选择或规则版本已改变。上方选择只影响下一次提取，现有清单保留。', { exact: true }).waitFor();
      await btn('关闭详情').click(); await choose(s.script2);
      assert.equal(await root.getByLabel('资产整理 Skill', { exact: true }).inputValue(), '');
      await root.getByText(/本次使用：音乐 MV 资产/).waitFor(); await btn('关闭详情').click(); await choose(s.script);
    });
    await check('导入 Markdown 可编辑、保存与导出，未保存关闭会提示', async () => {
      await btn('管理 Skill').click(); await dialog.waitFor();
      await dialog.getByLabel('导入 Skill Markdown', { exact: true }).setInputFiles({ name: '意象资产.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: 意象资产\nstage: assets\n---\n只提取文字已明确的视觉物件。') });
      await dialog.getByRole('button', { name: '关闭管理', exact: true }).click(); await dialog.getByText('有未保存的 Skill 修改。', { exact: false }).waitFor();
      await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
      const downloading = page.waitForEvent('download'); await dialog.getByRole('button', { name: '导出 Markdown', exact: true }).click();
      const download = await downloading; await download.saveAs(resolve('.local/exported-skill.md'));
      assert.ok((await readFile('.local/exported-skill.md', 'utf8')).includes('只提取文字已明确的视觉物件。'));
      await dialog.getByRole('button', { name: '保存并用于此剧本', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await idle();
      await root.getByLabel('资产整理 Skill', { exact: true }).selectOption(s.skillId); await idle();
    });
    await check('模型配置和笔记保存不覆盖 Skill 配置，测试前项目笔记全部保留', async () => {
      s.config = await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].skills.getSnapshot().config);
      await page.evaluate(async () => { const p = app.plugins.plugins['obcanvas-creator']; await p.saveAISettings(p.aiSettings); await p.flushDrafts(); await p.layout.flush(); });
      assert.deepEqual(JSON.parse(await readFile(resolve(vault, '影视项目/技能配置.json'), 'utf8')), s.config);
      for (const [path, raw] of notes) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
      s.notes = notes;
    });
    await writeFile('.local/skills-checkpoint.json', JSON.stringify(s));
  }
  await writeFile('.local/skills-results' + (process.argv.includes('--reopen') ? '-reopen' : '') + '.json', JSON.stringify({ checks }, null, 2));
} finally { if (server) await new Promise(r => server.close(r)); await browser.close(); }

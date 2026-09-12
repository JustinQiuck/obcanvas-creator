import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const vault = resolve('.local/test-vault'), checks = [], requests = [], scriptText = '小林推开资料室的门，把蓝色文件袋放在桌上。';
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347');
let page, server, slow = false;
try {
  for (const p of browser.contexts().flatMap(c => c.pages())) if (await p.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => '') === vault) { page = p; break; }
  assert.ok(page, '只允许操作隔离测试资料库'); page.setDefaultTimeout(12000);
  await page.waitForFunction(() => app.workspace.layoutReady && !app.plugins.plugins['obcanvas-creator']?.records.getSnapshot().loading);
  await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
  const root = page.locator('.obcanvas-library').first(); await root.waitFor();
  const btn = name => root.getByRole('button', { name, exact: true });
  const idle = () => page.waitForFunction(() => { const p = app.plugins.plugins['obcanvas-creator'], view = app.workspace.getLeavesOfType('obcanvas-film-view')[0].view; return !p.extractions.getSnapshot().busy && !p.storyboards.getSnapshot().busy && !view.editor.getSnapshot().saving && document.querySelector('.obcanvas-library')?.getAttribute('aria-busy') === 'false'; });
  const tab = async name => { await root.getByRole('navigation', { name: '项目工作区' }).getByRole('button', { name: new RegExp('^' + name) }).click(); await idle(); };
  const current = () => page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().selectedId);
  const record = id => page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.requireRecord(id), id);
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('通过：' + name); };
  if (process.argv.includes('--reopen')) {
    const s = JSON.parse(await readFile('.local/projects-checkpoint.json', 'utf8'));
    await check('完整重启恢复项目、分镜工作区、人工编辑、资产用途和媒体', async () => {
      const actual = await page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.libraryNavigation.getSnapshot());
      assert.deepEqual(actual, s.location);
      await root.getByLabel('镜头 1 拍摄理由', { exact: true }).waitFor();
      assert.equal(await root.getByLabel('镜头 1 拍摄理由', { exact: true }).inputValue(), '人工确认：先交代门与桌子的空间关系。');
      for (const expected of s.records) assert.deepEqual(await record(expected.id), expected);
      const preview = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.find(t => t.id === id), s.taskId);
      assert.equal(preview.items[0].intent, '人工确认：先交代门与桌子的空间关系。');
    });
    await check('重开后回到资产库，原项目其他文件逐字保留', async () => {
      await tab('资产库'); await root.locator(`[data-library-id="${s.person}"]`).click();
      await root.getByText('已确认使用', { exact: true }).waitFor();
      for (const [path, raw] of s.before) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
    });
  } else {
    const before = await page.evaluate(async () => Promise.all(app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.map(async r => [r.path, await app.vault.read(app.vault.getFileByPath(r.path))])));
    await page.evaluate(() => { const view = app.workspace.getLeavesOfType('obcanvas-film-view')[0].view; view.libraryNavigation.update({ projectId: '', section: 'scripts', scriptId: '' }); view.editor.clearSelection(); });
    const s = { before }, suffix = Date.now();
    server = createServer(async (req, res) => {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks).toString()); requests.push(request);
      if (slow) await new Promise(done => setTimeout(done, 1000));
      const context = JSON.parse(request.messages[1].content), isStoryboard = request.messages[0].content.includes('keyframePrompt');
      const output = isStoryboard ? { shots: [{ title: '门与桌子', evidence: scriptText, intent: '用全景先交代门与桌子的距离。', framing: '全景，门在前景、桌在背景。', camera: '固定平视机位。', start: '小林在门外，右手提文件袋。', action: '小林推门走向桌子。', end: '文件袋落在桌面。', sound: '门响与脚步声。', keyframePrompt: '全景平视，成年小林站在门外，右手提蓝色文件袋，门和桌形成纵深，灯光 TBD。', plannedDurationSeconds: 4 }] } : { assets: [{ kind: 'person', title: '小林', description: '提着文件袋。', evidence: '小林推开资料室的门', unresolved: [], needs: ['主参考'], existingId: context.existing.find(r => r.title === '小林')?.id ?? '' }] };
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    await page.evaluate(url => app.plugins.plugins['obcanvas-creator'].saveAISettings({ baseUrl: url, model: 'project-isolation-test' }), `http://127.0.0.1:${server.address().port}/v1`);
    await check('旧内容保留在原有项目，新建影片拥有独立工作台', async () => {
      assert.ok(await root.locator('[data-project-id="legacy-project"]').count());
      await root.getByLabel('新剧本项目名称', { exact: true }).fill(`项目甲 ${suffix}`); await btn('新建剧本项目').click(); await idle();
      s.projectA = await page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.libraryNavigation.getSnapshot().projectId);
      assert.equal(await root.locator('[data-library-id]').count(), 0);
      assert.equal(await root.getByRole('navigation', { name: '项目工作区' }).getByRole('button').count(), 5);
    });
    await check('剧本页只有正文编辑，切工作区先保存，不再堆叠 AI 表单', async () => {
      await btn('＋ 添加剧本').click(); await idle(); s.script = await current();
      await root.getByLabel('卡片标题', { exact: true }).fill('资料室第一场'); await root.getByLabel('卡片内容', { exact: true }).fill(scriptText);
      assert.equal(await root.locator('.obcanvas-extraction, .obcanvas-storyboard, .obcanvas-media-panel').count(), 0);
      await tab('资产库'); assert.equal((await record(s.script)).body, scriptText);
      assert.equal(await root.locator('[data-library-id]').count(), 0);
    });
    await check('项目资产无需场次即可建立、分类和绑定参考图', async () => {
      await btn('＋ 人物').click(); await idle(); s.person = await current();
      await root.getByLabel('卡片标题', { exact: true }).fill('小林'); await root.getByLabel('卡片内容', { exact: true }).fill('项目甲人物，成年，外观已确认。'); await btn('保存到笔记').click(); await idle();
      assert.equal((await record(s.person)).sceneId, undefined);
      await root.getByLabel('复制文件到资料库', { exact: true }).setInputFiles(resolve('.local/media-fixtures/参考图.png'));
      await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id)?.media?.length === 1, s.person);
      await root.getByLabel('图片参考用途', { exact: true }).selectOption('主参考'); await btn('确认使用此图').click(); await root.getByText('已确认使用', { exact: true }).waitFor();
      await root.getByLabel('用于剧本：资料室第一场', { exact: true }).click(); await idle(); assert.equal(await root.getByLabel('用于剧本：资料室第一场', { exact: true }).isChecked(), true);
      await root.getByRole('group', { name: '资产分类' }).getByRole('button', { name: /^道具/ }).click(); assert.equal(await root.locator('[data-library-id]').count(), 0);
      await root.getByRole('group', { name: '资产分类' }).getByRole('button', { name: /^全部/ }).click(); assert.equal(await root.locator('[data-library-id]').count(), 1);
    });
    await check('另一份剧本复用同一人物，画布显示同一个资产身份', async () => {
      await tab('剧本'); await btn('＋ 添加剧本').click(); await idle(); s.script2 = await current();
      await root.getByLabel('卡片标题', { exact: true }).fill('资料室第二场'); await root.getByLabel('卡片内容', { exact: true }).fill('小林回到资料室。');
      await tab('资产库'); await root.locator(`[data-library-id="${s.person}"]`).click(); await root.getByLabel('用于剧本：资料室第二场', { exact: true }).click(); await idle(); assert.equal(await root.getByLabel('用于剧本：资料室第二场', { exact: true }).isChecked(), true);
      await tab('画布'); await root.getByLabel('当前场次', { exact: true }).selectOption((await record(s.script2)).sceneId); await btn('总览').click();
      assert.equal(await root.locator(`[data-node-id="r:${s.person}"]`).count(), 1);
      await root.locator(`[data-node-id="r:${s.script2}"]`).click(); await root.getByRole('complementary', { name: '卡片详情' }).waitFor();
      assert.equal(await root.locator('.obcanvas-extraction, .obcanvas-storyboard').count(), 0);
      await btn('打开项目资产库').click(); await idle();
    });
    await check('第二项目的同名人物与默认 Skill 独立，不混入甲项目', async () => {
      await btn('← 剧本项目库').click(); await root.getByLabel('新剧本项目名称', { exact: true }).fill(`项目乙 ${suffix}`); await btn('新建剧本项目').click(); await idle();
      s.projectB = await page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.libraryNavigation.getSnapshot().projectId);
      await tab('资产库'); assert.equal(await root.locator('[data-library-id]').count(), 0);
      await btn('＋ 人物').click(); await idle(); s.otherPerson = await current();
      await root.getByLabel('卡片标题', { exact: true }).fill('小林'); await root.getByLabel('卡片内容', { exact: true }).fill('项目乙秘密，不能出现在甲的提示词里。');
      await tab('剧本'); await btn('＋ 添加剧本').click(); await idle();
      await root.getByLabel('卡片内容', { exact: true }).fill(scriptText); await tab('资产库'); await btn('从剧本整理资产').click();
      await btn('管理 Skill').click(); const dialog = root.getByRole('dialog', { name: '管理资产 Skill' }); await dialog.waitFor();
      await dialog.getByLabel('项目默认 Skill', { exact: true }).selectOption('mv-asset-extractor'); await dialog.getByRole('button', { name: '关闭管理', exact: true }).click();
      await btn('← 剧本项目库').click(); await root.locator(`[data-project-id="${s.projectA}"]`).click(); await tab('资产库');
      assert.equal(await root.locator(`[data-library-id="${s.otherPerson}"]`).count(), 0);
    });
    await check('独立资产整理工作区可选 Skill，真实请求只含本项目资产，确认复用', async () => {
      await btn('从剧本整理资产').click(); await root.getByLabel('工作区使用剧本', { exact: true }).selectOption(s.script);
      await root.getByLabel('资产整理 Skill', { exact: true }).selectOption('production-asset-extractor');
      await btn('整理拍摄资产').click(); await root.getByLabel('资产名称', { exact: true }).waitFor(); await idle();
      const context = JSON.parse(requests.at(-1).messages[1].content);
      assert.deepEqual(context.existing.map(r => r.id), [s.person]); assert.ok(!JSON.stringify(context).includes('项目乙秘密'));
      await btn('确认并生成资产卡').click(); await idle(); await btn('绑定参考图 · 小林').click();
      await root.getByRole('heading', { name: '绑定参考图', exact: true }).waitFor(); assert.equal(await current(), s.person);
      assert.equal((await record(s.script)).links.filter(l => l.from === `r:${s.person}`).length, 1);
    });
    await check('分镜在独立宽工作区生成、编辑、取消，并保留规则快照', async () => {
      await tab('分镜'); await root.getByLabel('工作区使用剧本', { exact: true }).selectOption(s.script);
      await btn('生成分镜预览').click(); await root.getByLabel('镜头 1 拍摄理由', { exact: true }).waitFor(); await idle();
      assert.equal(await root.locator('.obcanvas-inspector').count(), 0); assert.ok((await root.locator('.obcanvas-task-workspace').boundingBox()).width > 600);
      await root.getByLabel('镜头 1 拍摄理由', { exact: true }).fill('人工确认：先交代门与桌子的空间关系。'); await btn('保存分镜预览修改').click(); await idle();
      const task = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.find(t => t.scriptId === id), s.script); s.taskId = task.id;
      assert.ok(task.skill.prompt.includes('keyframePrompt')); slow = true;
      await btn('重新生成分镜预览').click(); await btn('取消分镜设计').click(); await idle(); slow = false;
      assert.equal(await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.filter(t => t.scriptId === id).length, s.script), 1);
      await page.screenshot({ path: '.local/projects-storyboard.png' });
    });
    await check('生成素材可导入与删除记录，原媒体保留', async () => {
      await tab('生成素材'); await root.getByLabel('导入项目素材', { exact: true }).setInputFiles(resolve('.local/media-fixtures/短视频.mp4'));
      await root.locator('.obcanvas-library-editor video').waitFor(); await idle(); s.video = await current();
      const uploaded = await record(s.video); assert.equal(uploaded.projectId, s.projectA); const path = uploaded.media[0].path;
      await btn('删除卡片').click(); await root.getByRole('dialog', { name: '确认删除卡片' }).getByRole('button', { name: '移入回收站', exact: true }).click(); await idle();
      assert.equal(await page.evaluate(path => !!app.vault.getFileByPath(path), path), true);
      assert.equal(await root.locator(`[data-library-id="${s.video}"]`).count(), 0);
    });
    await check('旧项目所有笔记逐字保留，资产库布局没有水平溢出', async () => {
      for (const [path, raw] of before) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
      await tab('资产库'); await root.locator(`[data-library-id="${s.person}"]`).click();
      assert.equal(await root.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      await page.screenshot({ path: '.local/projects-assets.png' });
      await tab('分镜'); await root.getByLabel('工作区使用剧本', { exact: true }).selectOption(s.script);
      await root.getByLabel('镜头 1 拍摄理由', { exact: true }).waitFor();
      s.location = await page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.libraryNavigation.getSnapshot());
      s.records = []; for (const id of [s.projectA, s.projectB, s.script, s.script2, s.person, s.otherPerson]) s.records.push(await record(id));
      await page.evaluate(async () => { const p = app.plugins.plugins['obcanvas-creator']; await p.extractions.flushDrafts(); await p.storyboards.flushDrafts(); await p.layout.flush(); await p.flushDrafts(); await app.workspace.saveLayout(); });
      await writeFile('.local/projects-checkpoint.json', JSON.stringify(s, null, 2));
    });
  }
  await writeFile('.local/projects-results' + (process.argv.includes('--reopen') ? '-reopen' : '') + '.json', JSON.stringify({ checks }, null, 2));
} catch (error) { if (page) await page.screenshot({ path: '.local/projects-failure.png' }); throw error; }
finally { if (server) await new Promise(done => server.close(done)); await browser.close(); }

// Browser plugin not available: use the project's Playwright/CDP Obsidian harness.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const vault = resolve('.local/test-vault'), checks = [], errors = [], requests = [];
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347');
let page, server;
try {
  for (const candidate of browser.contexts().flatMap(c => c.pages())) if (await candidate.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => '') === vault) { page = candidate; break; }
  assert.ok(page, '仅测试隔离 Obsidian'); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => app.workspace.layoutReady && !app.plugins.plugins['obcanvas-creator'].storyboardSettings.getSnapshot().loading);
  await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
  const root = page.locator('.obcanvas-library').first(); await root.waitFor();
  const btn = name => root.getByRole('button', { name, exact: true });
  const idle = () => page.waitForFunction(() => { const p = app.plugins.plugins['obcanvas-creator']; return !p.storyboards.getSnapshot().busy && !p.storyboardSettings.getSnapshot().busy && document.querySelector('.obcanvas-library')?.getAttribute('aria-busy') === 'false'; });
  const check = async (name, action) => { await action(); checks.push(name); console.log('通过：' + name); };
  if (process.argv.includes('--reopen')) {
    const saved = JSON.parse(await readFile('.local/gs01a-checkpoint.json', 'utf8'));
    await page.evaluate(saved => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.libraryNavigation.update(saved.location), saved);
    await check('完整重启恢复方法方向、正式镜头与应用进度', async () => {
      await root.getByLabel('镜头风格与节奏', { exact: true }).waitFor();
      assert.equal(await root.getByLabel('镜头风格与节奏', { exact: true }).inputValue(), '固定观察，横屏 16:9');
      const actual = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.find(t => t.id === id), saved.task.id);
      assert.deepEqual(actual, saved.task);
      for (const record of saved.shots) assert.deepEqual(await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.requireRecord(id), record.id), record);
      for (const [path, raw] of saved.before) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
    });
  } else {
    const scriptText = '小林右手拿着蓝色文件袋，站在资料室门外。他推开门，走到桌边，把文件袋放在桌上。';
    const fixture = { title: '门与桌子', evidence: scriptText, intent: '全景交代门与桌子的距离，观众看清文件袋的移动。', framing: '全景，门在前景、桌在中景', camera: '门内侧固定平视', start: '小林站在门外，右手拿蓝色文件袋，门关闭。', action: '小林推门走向桌子，把文件袋放在桌上。', end: '文件袋在桌面，小林右手已离开。', sound: '门响、脚步与文件袋落桌声，无对白。', keyframePrompt: '横屏 16:9 全景，门内侧固定平视，门关闭，小林在门外右手拿蓝色文件袋，光线 TBD。', plannedDurationSeconds: 5 };
    server = createServer(async (req, res) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); requests.push(JSON.parse(Buffer.concat(chunks).toString())); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ shots: [fixture] }) } }] })); });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const before = await page.evaluate(async () => Promise.all(app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.map(async r => [r.path, await app.vault.read(app.vault.getFileByPath(r.path))])));
    const state = await page.evaluate(async ({ scriptText, url }) => {
      const p = app.plugins.plugins['obcanvas-creator'];
      const project = await p.records.create('project', undefined, undefined, 'GS01a 中性验收');
      const scene = await p.records.create('scene', undefined, project.id, '资料室');
      const script = await p.records.create('script', scene.id, project.id, '文件袋'); await p.records.save(script, { title: script.title, body: scriptText });
      await p.saveAISettings({ baseUrl: url, model: 'gs01a-simulator' });
      const location = { projectId: project.id, section: 'storyboard', scriptId: script.id };
      app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.libraryNavigation.update(location);
      return { projectId: project.id, scriptId: script.id, location };
    }, { scriptText, url: `http://127.0.0.1:${server.address().port}/v1` });
    await check('分镜工作区可保存作品方向，修改未保存时阻止生成', async () => {
      await root.getByLabel('镜头风格与节奏', { exact: true }).fill('固定观察，横屏 16:9');
      assert.equal(await btn('生成分镜预览').isDisabled(), true);
      await btn('← 剧本项目库').click(); await idle();
      assert.equal(await root.getByLabel('镜头风格与节奏', { exact: true }).inputValue(), '固定观察，横屏 16:9');
      await root.locator('.obcanvas-alert').filter({ hasText: '分镜方法与方向有未保存修改' }).waitFor();
      await btn('保存分镜方法与方向').click(); await idle(); assert.equal(await btn('生成分镜预览').isDisabled(), false);
    });
    await check('复制内置分镜方法为自定义，并用于真实界面请求快照', async () => {
      await root.getByText('查看与自定义分镜规则', { exact: true }).click(); await btn('复制分镜规则为自定义').click();
      await root.getByLabel('分镜规则名称', { exact: true }).fill('GS01a 固定观察');
      await root.getByLabel('分镜规则正文', { exact: true }).fill('保留事实，先说明固定机位的具体理由。');
      await btn('保存并选择分镜规则').click(); await idle(); await btn('生成分镜预览').click();
      await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.some(t => t.scriptId === id), state.scriptId); await idle();
      assert.ok(requests[0].messages[0].content.includes('固定机位的具体理由')); assert.ok(requests[0].messages[0].content.includes('固定观察，横屏 16:9'));
      assert.equal(await page.evaluate(projectId => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.filter(r => r.kind === 'shot' && r.projectId === projectId).length, state.projectId), 0);
    });
    await check('入卡预览可取消；确认后只新增一个镜头并保留关键帧文案', async () => {
      await btn('检查正式入卡').click(); await root.getByRole('region', { name: '确认分镜入卡' }).waitFor(); await btn('取消入卡').click();
      await btn('检查正式入卡').click(); await btn('确认保存正式镜头').click();
      await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.find(t => t.scriptId === id)?.status === 'complete', state.scriptId); await idle();
      state.task = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.find(t => t.scriptId === id), state.scriptId);
      state.shots = await page.evaluate(projectId => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.filter(r => r.kind === 'shot' && r.projectId === projectId), state.projectId);
      assert.equal(state.shots.length, 1); assert.equal(state.shots[0].keyframePrompt, fixture.keyframePrompt); assert.equal(state.shots[0].plannedDuration, '5');
      await page.evaluate(task => app.plugins.plugins['obcanvas-creator'].storyboards.apply(task), state.task);
      assert.equal(await root.getByText('此预览已确认入卡；请在正式镜头中继续编辑。', { exact: false }).isVisible(), true);
    });
    await check('旧项目笔记逐字保留，正式动作与起止字段没有互相重复写入', async () => {
      for (const [path, raw] of before) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
      assert.equal(state.shots[0].body, fixture.action); assert.equal(state.shots[0].start, fixture.start); assert.equal(state.shots[0].end, fixture.end);
    });
    await check('重新生成保留已入卡历史，切换历史不新增正式镜头', async () => {
      await btn('重新生成分镜预览').click();
      await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.filter(t => t.scriptId === id).length === 2, state.scriptId); await idle();
      await root.getByLabel('分镜历史', { exact: true }).selectOption(state.task.id);
      assert.equal(await root.getByText('此预览已确认入卡；请在正式镜头中继续编辑。', { exact: false }).isVisible(), true);
      assert.equal(await page.evaluate(projectId => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.filter(r => r.kind === 'shot' && r.projectId === projectId).length, state.projectId), 1);
    });
    await page.evaluate(async () => { const p = app.plugins.plugins['obcanvas-creator']; await p.storyboards.flushDrafts(); await p.flushDrafts(); app.workspace.requestSaveLayout(); });
    await writeFile('.local/gs01a-checkpoint.json', JSON.stringify({ ...state, before }, null, 2));
  }
  assert.deepEqual(errors, []); await page.screenshot({ path: '.local/gs01a.png' });
  await writeFile('.local/gs01a-results' + (process.argv.includes('--reopen') ? '-reopen' : '') + '.json', JSON.stringify({ checks, errors, vault, title: await page.title(), url: page.url(), viewport: page.viewportSize(), browser: 'Browser plugin not available; Playwright/CDP existing harness' }, null, 2));
} catch (error) { if (page) { await page.screenshot({ path: '.local/gs01a-error.png' }).catch(() => {}); await writeFile('.local/gs01a-error.txt', await page.locator('body').innerText()).catch(() => {}); } throw error; }
finally { if (server) await new Promise(done => server.close(done)); await browser.close(); }

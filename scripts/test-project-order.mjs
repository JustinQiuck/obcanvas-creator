// Browser plugin not available; use the existing isolated Obsidian Playwright/CDP harness.
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const vault = resolve('.local/test-vault'), checks = [], errors = [];
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347');
let page;
try {
  for (const candidate of browser.contexts().flatMap(c => c.pages())) if (await candidate.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => '') === vault) { page = candidate; break; }
  assert.ok(page, '仅测试隔离资料库'); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
  await page.waitForFunction(() => app.workspace.layoutReady && !app.plugins.plugins['obcanvas-creator'].records.getSnapshot().loading);
  await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
  const root = page.locator('.obcanvas-library').first(); await root.waitFor();
  const panel = root.getByRole('region', { name: '全片镜头顺序', exact: true });
  const btn = name => panel.getByRole('button', { name, exact: true });
  const orderIds = () => panel.locator('[data-film-order-shot]').evaluateAll(nodes => nodes.map(n => n.dataset.filmOrderShot));
  const navigate = async location => { await page.evaluate(location => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.libraryNavigation.update(location), location); await panel.waitFor(); };
  const readOrder = projectId => page.evaluate(async id => (await app.plugins.plugins['obcanvas-creator'].records.requireRecord(id)).editOrder, projectId);
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('通过：' + name); };
  let state;
  if (process.argv.includes('--reopen')) {
    state = JSON.parse(await readFile('.local/project-order-checkpoint.json', 'utf8')); await navigate(state.location);
    await check('完整重启恢复全片順序与中文列表，原项目笔记保持不变', async () => {
      assert.deepEqual(await readOrder(state.project.id), state.expected);
      assert.deepEqual(await orderIds(), state.expected);
      for (const [path, raw] of state.before) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
      for (const [path, raw] of state.notes) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
    });
  } else {
    const before = await page.evaluate(async () => Promise.all(app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.map(async r => [r.path, await app.vault.read(app.vault.getFileByPath(r.path))])));
    state = await page.evaluate(async () => {
      const r = app.plugins.plugins['obcanvas-creator'].records;
      const project = await r.create('project', undefined, undefined, '全片顺序中性验收');
      const a = await r.create('scene', undefined, project.id, 'A 室内'), b = await r.create('scene', undefined, project.id, 'B 门外');
      const a1 = await r.create('shot', a.id, project.id, 'A1 看钟'), a2 = await r.create('shot', a.id, project.id, 'A2 听见门声'), b1 = await r.create('shot', b.id, project.id, 'B1 走近门');
      return { project, a, b, a1, a2, b1, location: { projectId: project.id, section: 'storyboard', scriptId: '' } };
    }); state.before = before; await navigate(state.location);
    const notes = await page.evaluate(async ids => Promise.all(ids.map(async id => { const r = await app.plugins.plugins['obcanvas-creator'].records.requireRecord(id); return [r.path, await app.vault.read(app.vault.getFileByPath(r.path))]; })), [state.a.id, state.b.id, state.a1.id, state.a2.id, state.b1.id]);
    await check('旧顺序草案需确认，跨场次 A1 → B1 → A2 可保存，未保存切换受保护', async () => {
      await btn('整理全片顺序草案').click(); assert.equal(await readOrder(state.project.id), undefined);
      await root.getByRole('button', { name: '← 剧本项目库', exact: true }).click(); await root.locator('.obcanvas-alert').filter({ hasText: '全片顺序草案尚未确认' }).waitFor();
      // Set the desired proposal by visible controls, independent of the initial scene-list order.
      let ids = await orderIds(); while (ids[0] !== state.a1.id) { await panel.getByLabel('全片上移：A1 看钟', { exact: true }).click(); ids = await orderIds(); }
      while (ids.indexOf(state.b1.id) > 1) { await panel.getByLabel('全片上移：B1 走近门', { exact: true }).click(); ids = await orderIds(); }
      await btn('确认保存全片顺序').click(); await btn('调整全片顺序').waitFor();
      assert.deepEqual(await readOrder(state.project.id), [state.a1.id, state.b1.id, state.a2.id]);
      for (const [path, raw] of notes) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
    });
    await check('新镜头待排，明确加入后场次视图投影全片位置', async () => {
      state.a3 = await page.evaluate(async state => app.plugins.plugins['obcanvas-creator'].records.create('shot', state.a.id, state.project.id, 'A3 回头'), state);
      await panel.locator(`[data-pending-shot="${state.a3.id}"]`).waitFor({ state: 'attached' });
      assert.ok(!(await readOrder(state.project.id)).includes(state.a3.id));
      await btn('调整全片顺序').click(); await panel.getByLabel('排到片尾：A3 回头', { exact: true }).click(); await panel.getByLabel('全片上移：A3 回头', { exact: true }).click();
      await btn('确认保存全片顺序').click(); await btn('调整全片顺序').waitFor();
      await panel.getByLabel('顺序查看范围').selectOption(state.a.id); assert.deepEqual(await orderIds(), [state.a1.id, state.a3.id, state.a2.id]);
      assert.deepEqual(await panel.locator('.obcanvas-order-number').allTextContents(), ['1', '3', '4']);
      await panel.getByLabel('顺序查看范围').selectOption('');
      await root.getByRole('navigation', { name: '项目工作区' }).getByRole('button', { name: '画布', exact: true }).click();
      await root.getByLabel('当前场次').selectOption(state.a.id); await root.getByRole('button', { name: '镜头顺序', exact: true }).click();
      assert.deepEqual(await root.locator('[data-order-shot]').evaluateAll(nodes => nodes.map(n => n.dataset.orderShot)), [state.a1.id, state.a3.id, state.a2.id]);
      assert.equal(await root.getByLabel('上移镜头：A2 听见门声', { exact: true }).count(), 0);
      await root.getByRole('button', { name: '去分镜工作区整理全片顺序', exact: true }).click(); await panel.waitFor();
    });
    await check('删除并恢复镜头保留全片位置，原场次和镜头笔记不受改序影响', async () => {
      await page.evaluate(async id => { const r = app.plugins.plugins['obcanvas-creator'].records; await r.trashCard(await r.requireRecord(id)); }, state.b1.id);
      await panel.getByText('1 个原镜头暂时缺失', { exact: false }).waitFor();
      assert.deepEqual(await orderIds(), [state.a1.id, state.a3.id, state.a2.id]);
      await page.evaluate(async pair => { await app.vault.create(pair[0], pair[1]); await app.plugins.plugins['obcanvas-creator'].records.refresh(); }, notes.find(([path]) => path === state.b1.path));
      assert.deepEqual(await orderIds(), [state.a1.id, state.b1.id, state.a3.id, state.a2.id]);
      for (const [path, raw] of notes) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
    });
    await check('保存失败保留顺序草案和原记录，重试后仅更新项目顺序', async () => {
      await btn('调整全片顺序').click(); await panel.getByLabel('全片下移：B1 走近门', { exact: true }).click();
      await page.evaluate(path => { window.orderOriginalProcess = app.vault.process; app.vault.process = async function(file, fn) { if (file.path === path) throw new Error('测试磁盘写入失败'); return window.orderOriginalProcess.call(this, file, fn); }; }, state.project.path);
      try { await btn('确认保存全片顺序').click(); await panel.getByRole('alert').filter({ hasText: '测试磁盘写入失败' }).waitFor(); assert.deepEqual(await readOrder(state.project.id), [state.a1.id, state.b1.id, state.a3.id, state.a2.id]); }
      finally { await page.evaluate(() => { app.vault.process = window.orderOriginalProcess; delete window.orderOriginalProcess; }); }
      await btn('确认保存全片顺序').click(); await btn('调整全片顺序').waitFor();
      state.expected = [state.a1.id, state.a3.id, state.b1.id, state.a2.id]; assert.deepEqual(await readOrder(state.project.id), state.expected);
      for (const [path, raw] of before) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw);
    });
    state.notes = notes;
    await page.evaluate(async () => { const p = app.plugins.plugins['obcanvas-creator']; await p.layout.flush(); await p.flushDrafts(); app.workspace.requestSaveLayout(); });
    await writeFile('.local/project-order-checkpoint.json', JSON.stringify(state, null, 2));
  }
  assert.deepEqual(errors, []); await root.locator('.obcanvas-task-workspace').evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ path: '.local/project-order.png' });
  await writeFile('.local/project-order-results' + (process.argv.includes('--reopen') ? '-reopen' : '') + '.json', JSON.stringify({ checks, errors, vault, title: await page.title(), url: page.url(), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), browser: 'Browser plugin not available; Playwright/CDP' }, null, 2));
} catch (e) { if (page) { await page.screenshot({ path: '.local/project-order-error.png' }).catch(() => {}); await writeFile('.local/project-order-error.txt', await page.locator('body').innerText()).catch(() => {}); } throw e; }
finally { if (page) await page.evaluate(() => { if (window.orderOriginalProcess) { app.vault.process = window.orderOriginalProcess; delete window.orderOriginalProcess; } }).catch(() => {}); await browser.close(); }

import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
const vault = resolve('.local/test-vault'), checks = [];
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347');
try {
  let page;
  for (const p of browser.contexts().flatMap(c => c.pages())) if (await p.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => '') === vault) { page = p; break; }
  assert.ok(page, '仅操作隔离资料库'); page.setDefaultTimeout(12000);
  await page.waitForFunction(() => app.workspace.layoutReady && !!app.plugins.plugins['obcanvas-creator']?.extractions);
  await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
  const root = page.locator('.obcanvas-free').first(), dialog = root.getByRole('dialog', { name: '确认删除卡片' });
  const btn = name => root.getByRole('button', { name, exact: true });
  const idle = () => page.waitForFunction(() => !document.querySelector('.obcanvas-free-tools button')?.disabled);
  const choose = async id => { await btn('总览').click(); await root.locator(`[data-node-id="${id}"]`).click(); await idle(); };
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('通过：' + name); };
  if (process.argv.includes('--reopen')) {
    const s = JSON.parse(await readFile('.local/deletion-checkpoint.json', 'utf8'));
    await check('完整重启后删除的卡片不再出现，共享素材和既有笔记保留', async () => {
      await root.getByLabel('当前场次', { exact: true }).selectOption(s.scene); await idle();
      assert.equal(await root.locator(`[data-node-id="r:${s.deleted}"]`).count(), 0);
      for (const [path, text] of s.preserved) assert.equal(await readFile(resolve(vault, path), 'utf8'), text);
      assert.deepEqual(await readFile(resolve(vault, s.ref.path)), await readFile('.local/media-fixtures/短视频.mp4'));
    });
  } else {
    const before = await page.evaluate(async () => { const p = app.plugins.plugins['obcanvas-creator']; return Promise.all(p.records.getSnapshot().records.map(async r => [r.path, await app.vault.read(app.vault.getFileByPath(r.path))])); });
    const s = await page.evaluate(async () => {
      const p = app.plugins.plugins['obcanvas-creator'], scene = await p.records.create('scene');
      const person = await p.records.create('person', scene.id), shot = await p.records.create('shot', scene.id);
      await p.records.attachScriptAsset(await p.records.create('script', scene.id), person.id);
      return { scene: scene.id, deleted: person.id, shot: shot.id };
    });
    await root.getByLabel('当前场次', { exact: true }).selectOption(s.scene); await idle();
    await check('编辑退格只改文字，删除入口保存最新草稿，取消不删除', async () => {
      await choose(`r:${s.deleted}`);
      const title = root.getByLabel('卡片标题', { exact: true }); await title.fill('删除测试甲'); await title.press('Backspace');
      assert.equal(await dialog.count(), 0); assert.equal(await title.inputValue(), '删除测试');
      await btn('删除卡片').click(); await dialog.waitFor();
      await dialog.getByRole('heading', { name: '删除卡片「删除测试」？', exact: true }).waitFor();
      await dialog.getByText(/有 1 张卡片引用它/).waitFor();
      await dialog.getByRole('button', { name: '取消', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      assert.equal(await root.locator(`[data-node-id="r:${s.deleted}"]`).count(), 1);
    });
    await check('键盘删除针对实际聚焦卡片，取消不影响原选中卡', async () => {
      await root.locator(`[data-node-id="r:${s.shot}"]`).press('Backspace'); await dialog.waitFor();
      await dialog.getByRole('heading', { name: '删除卡片「新镜头」？', exact: true }).waitFor();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await root.locator(`[data-node-id="r:${s.deleted}"]`).count(), 1);
    });
    await check('Delete 键只打开确认，确认后原笔记进入库内回收站', async () => {
      await root.locator(`[data-node-id="r:${s.deleted}"]`).press('Delete'); await dialog.waitFor();
      const r = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.requireRecord(id), s.deleted);
      const raw = await readFile(resolve(vault, r.path), 'utf8');
      await dialog.getByRole('button', { name: '移入回收站', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await idle();
      assert.equal(await root.locator(`[data-node-id="r:${s.deleted}"]`).count(), 0);
      const trashed = (await readdir(resolve(vault, '.trash'), { recursive: true })).filter(p => p.endsWith(basename(r.path)));
      assert.equal(trashed.length, 1); assert.equal(await readFile(resolve(vault, '.trash', trashed[0]), 'utf8'), raw);
    });
    await check('素材卡可移除，已采用时显示原因，取消采用后移除并保留视频', async () => {
      await choose(`r:${s.shot}`);
      await root.getByLabel('复制文件到资料库', { exact: true }).setInputFiles(resolve('.local/media-fixtures/短视频.mp4'));
      await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id)?.media?.length === 1, s.shot);
      await btn('采用此视频').click(); await idle();
      s.ref = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id).media[0], s.shot);
      await btn('关闭详情').click(); await choose(`m:${s.ref.id}`); await btn('移除素材卡').click(); await dialog.waitFor();
      await dialog.getByRole('button', { name: '确认移除素材卡', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: '此素材已有镜头采用' }).waitFor();
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await page.evaluate(async id => { const p = app.plugins.plugins['obcanvas-creator']; const r = await p.records.requireRecord(id); await p.records.decide(r, r.media[0].id, 'candidate'); }, s.shot);
      await btn('移除素材卡').click(); await dialog.getByRole('button', { name: '确认移除素材卡', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); await idle();
      assert.equal(await root.locator(`[data-node-id="m:${s.ref.id}"]`).count(), 0);
      assert.deepEqual(await readFile(resolve(vault, s.ref.path)), await readFile('.local/media-fixtures/短视频.mp4'));
    });
    await check('测试前全部笔记逐字保持不变', async () => { for (const [path, raw] of before) assert.equal(await readFile(resolve(vault, path), 'utf8'), raw); });
    s.preserved = before;
    await page.evaluate(async () => { const p = app.plugins.plugins['obcanvas-creator']; await p.flushDrafts(); await p.layout.flush(); });
    await writeFile('.local/deletion-checkpoint.json', JSON.stringify(s));
  }
  await writeFile('.local/deletion-results' + (process.argv.includes('--reopen') ? '-reopen' : '') + '.json', JSON.stringify({ checks }, null, 2));
} finally { await browser.close(); }

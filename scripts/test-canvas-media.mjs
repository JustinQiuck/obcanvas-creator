import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const vaultPath = resolve('.local/test-vault');
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347');
const checks = [];
let page;
async function check(name, run) { await run(); checks.push(name); console.log('通过：' + name); }
try {
  for (const p of browser.contexts().flatMap(c => c.pages())) if (await p.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => null) === vaultPath) { page = p; break; }
  assert.ok(page, '必须是项目隔离测试资料库'); page.setDefaultTimeout(8000);
  await page.waitForFunction(() => app.plugins.plugins['obcanvas-creator']?.ready);
  const checkpoint = '.local/p0-bc-checkpoint.json';
  let expected;
  if (process.argv.includes('--reopen')) {
    expected = JSON.parse(await readFile(checkpoint, 'utf8'));
    await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
    await page.waitForFunction(id => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().selectedId === id, expected.record.id);
    await check('完整重启后恢复同一镜头、卡片坐标、缩放与素材路径', async () => {
      const actual = await page.evaluate(sceneId => app.plugins.plugins['obcanvas-creator'].layout.getSnapshot().data.scenes[sceneId], expected.record.sceneId);
      assert.deepEqual(actual, expected.layout);
      await page.locator('.obcanvas-media-panel').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => { const v = document.querySelector('.obcanvas-root video'); return v?.readyState >= 1 && document.querySelector('.obcanvas-root img')?.naturalWidth === 640; });
      const refs = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id).media, expected.record.id);
      assert.deepEqual(refs, expected.record.media);
    });
  } else {
    await page.evaluate(async () => { await app.plugins.unloadPlugin('obcanvas-creator'); await app.plugins.loadPlugin('obcanvas-creator'); });
    await page.evaluate(async () => { const plugin = app.plugins.plugins['obcanvas-creator']; await plugin.layout.flush(); for (const leaf of app.workspace.getLeavesOfType('obcanvas-film-view')) leaf.detach(); await plugin.openView(); });
    await page.getByRole('button', { name: '新建场次', exact: true }).click();
    await page.getByRole('button', { name: '添加镜头', exact: true }).click();
    await page.getByLabel('镜头标题', { exact: true }).fill('窗边的光线');
    await page.getByLabel('镜头内容', { exact: true }).fill('中性验收：固定机位记录窗边光影。测试图和短视频只用于验证素材关联。');
    await page.getByRole('button', { name: '保存到笔记', exact: true }).click();
    await page.locator('[data-save-status="saved"]').waitFor();
    const record = await page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().base);
    const canvas = page.getByRole('region', { name: '镜头画布', exact: true });
    const card = page.getByRole('button', { name: '镜头卡：窗边的光线', exact: true });
    await check('真实鼠标移动卡片并保存布局', async () => {
      await card.scrollIntoViewIfNeeded();
      const box = await card.boundingBox(); assert.ok(box);
      await page.mouse.move(box.x + 100, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 175, box.y + 105, { steps: 8 }); await page.mouse.up();
      await page.locator('[data-layout-status="saved"]').waitFor();
      const data = JSON.parse(await readFile(resolve(vaultPath, '影视项目/画布布局.json'), 'utf8'));
      assert.deepEqual(data.scenes[record.sceneId].positions[record.id], { x: 75, y: 45 });
      assert.ok(!JSON.stringify(data).includes('窗边'));
    });
    await check('鼠标中心缩放、平移，保存视口且不改动正文', async () => {
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox(); const before = await readFile(resolve(vaultPath, record.path), 'utf8');
      await page.mouse.move(box.x + 200, box.y + 280); await page.mouse.wheel(0, -200);
      await page.waitForFunction(s => app.plugins.plugins['obcanvas-creator'].layout.getSnapshot().data.scenes[s].viewport.k > 1, record.sceneId);
      await page.getByRole('button', { name: '平移', exact: true }).click();
      const initial = await page.evaluate(s => app.plugins.plugins['obcanvas-creator'].layout.getSnapshot().data.scenes[s].viewport, record.sceneId);
      await page.mouse.move(box.x + 200, box.y + 280); await page.mouse.down(); await page.mouse.move(box.x + 230, box.y + 295, { steps: 6 }); await page.mouse.up();
      await page.getByRole('button', { name: '选择', exact: true }).click();
      await page.locator('[data-layout-status="saved"]').waitFor();
      const v = await page.evaluate(s => app.plugins.plugins['obcanvas-creator'].layout.getSnapshot().data.scenes[s].viewport, record.sceneId);
      assert.ok(Math.abs(v.x - initial.x - 30) < .001); assert.ok(Math.abs(v.y - initial.y - 15) < .001); assert.equal(v.k, initial.k);
      assert.equal(await readFile(resolve(vaultPath, record.path), 'utf8'), before);
      assert.equal(await page.evaluate(() => document.body.style.cursor), '');
    });
    const folder = `测试素材-${Date.now()}`;
    const png = [...await readFile('.local/media-fixtures/参考图.png')], mp4 = [...await readFile('.local/media-fixtures/短视频.mp4')];
    await page.evaluate(async ({ folder, png, mp4 }) => {
      await app.vault.createFolder(folder);
      await app.vault.createBinary(`${folder}/参考图 #1.png`, new Uint8Array(png).buffer);
      await app.vault.createBinary(`${folder}/短视频.mp4`, new Uint8Array(mp4).buffer);
    }, { folder, png, mp4 });
    async function pick(path, button) {
      await button.click(); await page.getByPlaceholder('搜索资料库内的图片或视频…').fill(path);
      await page.locator('.suggestion-item').filter({ hasText: path }).first().click();
    }
    const add = page.getByRole('button', { name: '关联库内素材', exact: true });
    await check('中文选择器关联库内图片与视频，比例、时长和播放正确', async () => {
      await pick(`${folder}/参考图 #1.png`, add);
      await page.waitForFunction(() => document.querySelector('.obcanvas-root img')?.naturalWidth === 640);
      await pick(`${folder}/短视频.mp4`, add);
      await page.waitForFunction(() => document.querySelector('.obcanvas-root video')?.readyState >= 1);
      const info = await page.locator('.obcanvas-root video').evaluate(async v => { await v.play(); return { width: v.videoWidth, height: v.videoHeight, duration: v.duration }; });
      assert.deepEqual(info, { width: 640, height: 360, duration: 2 });
      await page.waitForFunction(() => document.querySelector('.obcanvas-root video')?.currentTime > .1);
      await page.locator('.obcanvas-root video').evaluate(v => v.pause());
      const raw = await readFile(resolve(vaultPath, record.path), 'utf8'); assert.ok(raw.includes(folder)); assert.ok(!raw.includes('blob:') && !raw.includes('app://'));
    });
    let refs = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id).media, record.id);
    await check('同一素材关联第二镜头时复用稳定 ID，重复关联不增加副本', async () => {
      await page.evaluate(async ({ id, sceneId, path }) => {
        const p = app.plugins.plugins['obcanvas-creator'];
        await p.media.attach(id, path);
        const other = await p.records.create('shot', sceneId); await p.media.attach(other.id, path); globalThis.__p0OtherShot = other.id;
      }, { id: record.id, sceneId: record.sceneId, path: `${folder}/参考图 #1.png` });
      const all = await page.evaluate(id => { const rs = app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records; return [rs.find(r => r.id === id).media, rs.find(r => r.id === globalThis.__p0OtherShot).media]; }, record.id);
      assert.equal(all[0].length, 2); assert.equal(all[0][0].id, all[1][0].id);
    });
    const renamedFolder = `${folder}-改名`;
    await check('资料库文件夹改名后，所有镜头关联路径更新且 ID 保持不变', async () => {
      await page.evaluate(async ({ folder, renamedFolder }) => app.fileManager.renameFile(app.vault.getAbstractFileByPath(folder), renamedFolder), { folder, renamedFolder });
      await page.waitForFunction(({ id, prefix }) => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id).media.every(m => m.path.startsWith(prefix + '/')), { id: record.id, prefix: renamedFolder });
      const changed = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id).media, record.id);
      assert.deepEqual(changed.map(m => m.id), refs.map(m => m.id)); refs = changed;
      await page.waitForFunction(() => document.querySelector('.obcanvas-root img')?.naturalWidth === 640);
    });
    await check('素材丢失明确提示，中文重新关联后恢复视频且保留 ID', async () => {
      const videoRef = refs.find(r => r.path.endsWith('.mp4'));
      await page.evaluate(path => app.vault.trash(app.vault.getFileByPath(path), true), videoRef.path);
      const figure = page.locator(`[data-media-id="${videoRef.id}"]`);
      await figure.getByText('素材缺失，请恢复文件或重新关联。', { exact: true }).waitFor();
      const replacement = `${renamedFolder}/重新定位.mp4`;
      await page.evaluate(async ({ path, bytes }) => { await app.vault.createBinary(path, new Uint8Array(bytes).buffer); }, { path: replacement, bytes: mp4 });
      await pick(replacement, figure.getByRole('button', { name: '重新关联', exact: true }));
      await page.waitForFunction(() => document.querySelector('.obcanvas-root video')?.readyState >= 1);
      const newRefs = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id).media, record.id);
      assert.equal(newRefs.find(r => r.path === replacement).id, videoRef.id);
    });
    await check('无法解码的视频显示具体错误，移除关联不删除源文件', async () => {
      const bad = `${renamedFolder}/损坏.mp4`;
      await page.evaluate(async path => { await app.vault.create(path, 'not a video'); }, bad); await pick(bad, add);
      await page.getByText('视频无法播放，文件可能损坏或编码不受支持，请重新关联。', { exact: true }).waitFor();
      const figure = page.locator('.obcanvas-media-grid figure').filter({ hasText: '损坏.mp4' });
      await figure.getByRole('button', { name: '移除关联', exact: true }).click(); await figure.waitFor({ state: 'detached' });
      assert.equal(await readFile(resolve(vaultPath, bad), 'utf8'), 'not a video');
    });
    await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].layout.flush());
    expected = await page.evaluate(id => { const p = app.plugins.plugins['obcanvas-creator']; const record = p.records.getSnapshot().records.find(r => r.id === id); return { record, layout: p.layout.getSnapshot().data.scenes[record.sceneId] }; }, record.id);
    await writeFile(checkpoint, JSON.stringify(expected, null, 2));
  }
  await check('关联变化不打断无关视频播放，两个标签页的视口互不干扰', async () => {
    await page.locator('.obcanvas-media-panel').scrollIntoViewIfNeeded();
    await page.locator('.obcanvas-root video').evaluate(async v => { globalThis.__p0Playing = v; v.loop = true; await v.play(); });
    await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].media.changed());
    assert.equal(await page.evaluate(() => document.querySelector('.obcanvas-root video') === __p0Playing && !__p0Playing.paused), true);
    await page.locator('.obcanvas-root video').evaluate(v => { v.pause(); v.loop = false; });
    const original = await page.evaluate(scene => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.viewports.getSnapshot()[scene], expected.record.sceneId);
    await page.evaluate(async id => { await app.plugins.plugins['obcanvas-creator'].openView(true); app.workspace.getLeavesOfType('obcanvas-film-view')[1].view.editor.select(id); }, expected.record.id);
    const surface = page.locator('.obcanvas-root:visible').getByRole('region', { name: '镜头画布', exact: true });
    await surface.scrollIntoViewIfNeeded(); const box = await surface.boundingBox();
    await page.mouse.move(box.x + 150, box.y + 280); await page.mouse.wheel(0, 150);
    await page.waitForFunction(({ scene, k }) => { const actual = app.workspace.getLeavesOfType('obcanvas-film-view')[1].view.viewports.getSnapshot()[scene]?.k; return typeof actual === 'number' && actual !== k; }, { scene: expected.record.sceneId, k: original.k });
    assert.deepEqual(await page.evaluate(scene => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.viewports.getSnapshot()[scene], expected.record.sceneId), original);
    await page.evaluate(async ({ scene, viewport }) => {
      app.workspace.getLeavesOfType('obcanvas-film-view')[1].detach();
      const first = app.workspace.getLeavesOfType('obcanvas-film-view')[0]; await app.workspace.revealLeaf(first);
      app.plugins.plugins['obcanvas-creator'].layout.update(scene, viewport); await app.plugins.plugins['obcanvas-creator'].layout.flush();
    }, { scene: expected.record.sceneId, viewport: original });
  });
  await check('旁边原生笔记的空格输入正常，画布没有全局光标残留', async () => {
    await page.getByRole('button', { name: '打开对应笔记', exact: true }).click();
    await page.waitForFunction(() => !!app.workspace.activeEditor?.editor);
    await page.evaluate(() => { const e = app.workspace.activeEditor.editor; e.setCursor(e.lastLine(), e.getLine(e.lastLine()).length); e.focus(); });
    await page.keyboard.type(' native space check');
    assert.ok(await page.evaluate(() => app.workspace.activeEditor.editor.getValue().endsWith(' native space check')));
    assert.equal(await page.evaluate(() => document.body.style.cursor), '');
  });
  await check('主题跟随宿主，关闭视图后画布元素和媒体播放资源释放', async () => {
    await page.evaluate(() => { document.body.classList.remove('theme-dark'); document.body.classList.add('theme-light'); });
    await page.locator('.obcanvas-surface[data-theme="light"]').waitFor();
    await page.evaluate(() => { document.body.classList.remove('theme-light'); document.body.classList.add('theme-dark'); });
    await page.locator('.obcanvas-surface[data-theme="dark"]').waitFor();
    await page.evaluate(() => { globalThis.__p0Video = document.querySelector('.obcanvas-root video'); app.workspace.getLeavesOfType('obcanvas-film-view')[0].detach(); });
    assert.equal(await page.locator('.obcanvas-surface').count(), 0);
    assert.deepEqual(await page.evaluate(() => ({ paused: __p0Video.paused, source: __p0Video.getAttribute('src') })), { paused: true, source: null });
    await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
    await page.evaluate(id => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.select(id), expected.record.id);
    await page.waitForFunction(() => document.querySelector('.obcanvas-root video')?.readyState >= 1);
  });
  await page.screenshot({ path: process.argv.includes('--reopen') ? '.local/p0-bc-reopened.png' : '.local/p0-bc-host.png' });
  const report = { title: await page.title(), result: 'PASS', checks };
  await writeFile(process.argv.includes('--reopen') ? '.local/p0-bc-reopen-report.json' : '.local/p0-bc-host-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }

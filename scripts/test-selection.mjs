import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347');
const vaultPath = resolve('.local/test-vault'), checkpoint = '.local/p1-checkpoint.json';
let page; const checks = [];
async function check(name, run) { await run(); checks.push(name); console.log('通过：' + name); }
try {
  for (const p of browser.contexts().flatMap(c => c.pages())) if (await p.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => null) === vaultPath) { page = p; break; }
  assert.ok(page, '只允许操作项目隔离测试库'); page.setDefaultTimeout(10000);
  await page.waitForFunction(() => app.plugins.plugins['obcanvas-creator']?.ready);
  await page.waitForFunction(() => !app.plugins.plugins['obcanvas-creator'].records.getSnapshot().loading);
  async function record(id) { return page.evaluate(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id), id); }
  async function select(id) { await page.locator(`[data-order-shot="${id}"] button`).first().click(); await page.waitForFunction(id => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().selectedId === id, id); }
  async function save() { await page.getByRole('button', { name: '保存到笔记', exact: true }).click(); await page.locator('[data-save-status="saved"]').waitFor(); }
  let state;
  if (process.argv.includes('--reopen')) {
    state = JSON.parse(await readFile(checkpoint, 'utf8'));
    await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
    await page.waitForFunction(id => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().selectedId === id, state.a);
    await check('完整重启后恢复三个镜头、明确顺序、规划字段和独立选片决定', async () => {
      assert.deepEqual((await record(state.scene)).shotOrder, state.order);
      for (const id of [state.a, state.b, state.c]) {
        const current = await record(id), before = state.records.find(r => r.id === id);
        assert.deepEqual(current.media, before.media); assert.equal(current.body, before.body); assert.equal(current.intent, before.intent); assert.equal(current.framing, before.framing);
      }
      await page.locator(`[data-order-shot="${state.a}"] [data-shot-status="已采用"]`).waitFor();
      await page.locator(`[data-order-shot="${state.b}"] [data-shot-status="待素材"]`).waitFor();
      await page.locator(`[data-order-shot="${state.c}"] [data-shot-status="待重做"]`).waitFor();
    });
  } else {
    await page.evaluate(async () => { await app.plugins.unloadPlugin('obcanvas-creator'); await app.plugins.loadPlugin('obcanvas-creator'); for (const leaf of app.workspace.getLeavesOfType('markdown')) leaf.detach(); await app.plugins.plugins['obcanvas-creator'].openView(); });
    await page.getByRole('button', { name: '新建场次', exact: true }).click();
    async function create(title) {
      await page.getByRole('button', { name: '添加镜头', exact: true }).click();
      await page.getByLabel('镜头标题', { exact: true }).fill(title);
      await page.getByLabel('镜头内容', { exact: true }).fill(`中性制作测试：${title}，固定机位记录房间里的光线。`);
      await save(); return page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().base.id);
    }
    state = {};
    await check('中文界面建立三个镜头，保存理由、景别、机位及来源', async () => {
      state.a = await create('A · 窗边的光线');
      await page.getByText('镜头规划（理由、景别、机位）', { exact: true }).click();
      await page.getByLabel('拍摄理由', { exact: true }).fill('建立空间位置，为后续镜头提供方向');
      await page.getByLabel('景别', { exact: true }).selectOption('全景');
      await page.getByLabel('机位与运动', { exact: true }).fill('门口平视，固定机位');
      await page.getByText('提示词与来源（可选）', { exact: true }).click();
      await page.getByLabel('原提示词', { exact: true }).fill('测试提示词：房间内的自然光线');
      await page.getByLabel('来源备注', { exact: true }).fill('中性离线测试文件'); await save();
      state.scene = (await record(state.a)).sceneId;
      state.b = await create('B · 桌上的杯子'); state.c = await create('C · 墙上的影子');
      assert.deepEqual((await record(state.scene)).shotOrder, [state.a, state.b, state.c]);
    });
    const videoBytes = await readFile('.local/media-fixtures/短视频.mp4');
    await check('选择本地文件及拖入文件均复制到库内；导入后为待选片', async () => {
      await select(state.a);
      await page.getByLabel('复制文件到资料库', { exact: true }).setInputFiles({ name: '版本一.mp4', mimeType: 'video/mp4', buffer: videoBytes });
      await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id).media?.length === 1, state.a);
      const transfer = await page.evaluateHandle(bytes => { const d = new DataTransfer(); d.items.add(new File([new Uint8Array(bytes)], '版本二.mp4', { type: 'video/mp4' })); return d; }, [...videoBytes]);
      await page.getByRole('region', { name: '镜头素材', exact: true }).dispatchEvent('drop', { dataTransfer: transfer }); await transfer.dispose();
      await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === id).media?.length === 2, state.a);
      await page.locator(`[data-order-shot="${state.a}"] [data-shot-status="待选片"]`).waitFor();
      for (const ref of (await record(state.a)).media) assert.deepEqual(await readFile(resolve(vaultPath, ref.path)), videoBytes);
    });
    const refs = (await record(state.a)).media; state.v1 = refs[0].id; state.v2 = refs[1].id;
    const figure = id => page.locator(`[data-media-id="${id}"]`);
    await check('选择并替换采用版本，旧候选与原文件均保留', async () => {
      await figure(state.v1).getByRole('button', { name: '采用此视频', exact: true }).click();
      await figure(state.v1).getByText('已采用', { exact: true }).waitFor();
      await figure(state.v2).getByRole('button', { name: '采用此视频', exact: true }).click();
      await figure(state.v2).getByText('已采用', { exact: true }).waitFor();
      const current = await record(state.a); assert.equal(current.media.length, 2); assert.equal(current.media[0].decision, 'candidate'); assert.equal(current.media[1].decision, 'adopted');
      assert.ok(await figure(state.v2).getByRole('button', { name: '移除关联', exact: true }).isDisabled());
    });
    await check('同一素材在另一镜头独立退回，保存原因并形成三种制作状态', async () => {
      await select(state.c); await page.getByRole('button', { name: '关联库内素材', exact: true }).click();
      await page.getByPlaceholder('搜索资料库内的图片或视频…').fill(refs[1].path);
      await page.locator('.suggestion-item').filter({ hasText: refs[1].path }).first().click();
      await figure(state.v2).getByLabel('退回原因', { exact: true }).fill('此机位不符合 C 镜头的构图，需要重做');
      await figure(state.v2).getByRole('button', { name: '退回重做', exact: true }).click();
      await page.locator(`[data-order-shot="${state.c}"] [data-shot-status="待重做"]`).waitFor();
      assert.equal((await record(state.a)).media.find(m => m.id === state.v2).decision, 'adopted');
      assert.equal((await record(state.c)).media[0].reason, '此机位不符合 C 镜头的构图，需要重做');
      await page.locator('[data-progress="已采用"]').getByText('已采用 1', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-progress="待素材"]').innerText(), '待素材 1');
    });
    await check('上移两次改变正式镜头顺序，画布位置不随排序移动', async () => {
      await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].layout.flush());
      const before = await page.evaluate(scene => app.plugins.plugins['obcanvas-creator'].layout.getSnapshot().data.scenes[scene].positions, state.scene);
      await page.getByRole('button', { name: '上移镜头：C · 墙上的影子', exact: true }).click();
      await page.waitForFunction(({ scene, c }) => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === scene).shotOrder[1] === c, { scene: state.scene, c: state.c });
      await page.getByRole('button', { name: '上移镜头：C · 墙上的影子', exact: true }).click();
      await page.waitForFunction(({ scene, c }) => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === scene).shotOrder[0] === c, { scene: state.scene, c: state.c });
      assert.deepEqual((await record(state.scene)).shotOrder, [state.c, state.a, state.b]);
      assert.deepEqual(await page.evaluate(scene => app.plugins.plugins['obcanvas-creator'].layout.getSnapshot().data.scenes[scene].positions, state.scene), before);
    });
    await check('两个宿主视图使用过期候选做决定时拒绝覆盖', async () => {
      await select(state.a);
      await page.evaluate(async id => { await app.plugins.plugins['obcanvas-creator'].openView(true); app.workspace.getLeavesOfType('obcanvas-film-view')[1].view.editor.select(id); }, state.a);
      const result = await page.evaluate(async ({ id, v1, v2 }) => {
        const p = app.plugins.plugins['obcanvas-creator'];
        const base = p.records.getSnapshot().records.find(r => r.id === id);
        await p.media.decide(base, v1, 'adopted');
        try { await p.media.decide(base, v2, 'adopted'); return 'unexpected success'; } catch (e) { return e.message; }
      }, { id: state.a, v1: state.v1, v2: state.v2 });
      assert.match(result, /其他窗口/); assert.equal((await record(state.a)).media.find(m => m.id === state.v1).decision, 'adopted');
      await page.evaluate(async () => { app.workspace.getLeavesOfType('obcanvas-film-view')[1].detach(); await app.workspace.revealLeaf(app.workspace.getLeavesOfType('obcanvas-film-view')[0]); });
    });
    await check('选片保存失败显示错误且不假报采用，重试可成功', async () => {
      const shot = await record(state.a);
      await page.evaluate(path => { globalThis.__p1Process = app.vault.process; app.vault.process = function(f, fn, opts) { return f.path === path ? Promise.reject(new Error('测试：选片写入失败')) : __p1Process.call(this, f, fn, opts); }; }, shot.path);
      try {
        await figure(state.v2).getByRole('button', { name: '采用此视频', exact: true }).click();
        await page.getByText('测试：选片写入失败', { exact: true }).waitFor();
        assert.equal((await record(state.a)).media.find(m => m.id === state.v1).decision, 'adopted');
      } finally { await page.evaluate(() => { app.vault.process = __p1Process; delete globalThis.__p1Process; }); }
      await figure(state.v2).getByRole('button', { name: '采用此视频', exact: true }).click(); await figure(state.v2).getByText('已采用', { exact: true }).waitFor();
    });
    await check('采用素材缺失单独提示，恢复后保留采用与其他镜头退回原因', async () => {
      const ref = (await record(state.a)).media.find(m => m.id === state.v2);
      await page.evaluate(async path => { await app.vault.trash(app.vault.getFileByPath(path), true); }, ref.path);
      await page.locator(`[data-order-shot="${state.a}"]`).getByText('素材缺失／无法读取', { exact: true }).waitFor();
      await page.locator(`[data-order-shot="${state.a}"] [data-shot-status="已采用"]`).waitFor();
      await page.evaluate(async ({ path, bytes }) => { await app.vault.createBinary(path, new Uint8Array(bytes).buffer); }, { path: ref.path, bytes: [...videoBytes] });
      await page.locator(`[data-order-shot="${state.a}"] .obcanvas-missing`).waitFor({ state: 'detached' });
      assert.equal((await record(state.c)).media[0].decision, 'rejected');
    });
    await check('素材改名及笔记补充内容不抹掉顺序和选片结果', async () => {
      const ref = (await record(state.a)).media.find(m => m.id === state.v2), renamed = ref.path.replace('.mp4', '-改名.mp4');
      await page.evaluate(async ({ path, renamed }) => { await app.fileManager.renameFile(app.vault.getFileByPath(path), renamed); }, { path: ref.path, renamed });
      await page.waitForFunction(({ a, renamed }) => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r => r.id === a).media.some(m => m.path === renamed), { a: state.a, renamed });
      await page.getByLabel('镜头内容', { exact: true }).fill('已补充镜头内容，保留规划与选片结果。'); await save();
      const saved = await record(state.a); assert.equal(saved.framing, '全景'); assert.equal(saved.intent, '建立空间位置，为后续镜头提供方向'); assert.equal(saved.media.find(m => m.id === state.v2).decision, 'adopted');
      assert.equal((await record(state.c)).media[0].decision, 'rejected');
    });
    state.order = (await record(state.scene)).shotOrder; state.records = await Promise.all([state.a, state.b, state.c].map(record));
    await writeFile(checkpoint, JSON.stringify(state, null, 2));
  }
  await check('不支持的文件给出中文错误，候选与采用决定保持不变', async () => {
    const before = (await record(state.a)).media;
    await page.getByLabel('复制文件到资料库', { exact: true }).setInputFiles({ name: '不支持.txt', mimeType: 'text/plain', buffer: Buffer.from('测试非媒体文件') });
    await page.getByText('请选择支持的图片或视频格式。', { exact: true }).waitFor();
    assert.deepEqual((await record(state.a)).media, before);
  });
  await page.locator('.obcanvas-order').scrollIntoViewIfNeeded();
  await page.screenshot({ path: process.argv.includes('--reopen') ? '.local/p1-reopened.png' : '.local/p1-host.png' });
  const report = { title: await page.title(), checks, result: 'PASS' };
  await writeFile(process.argv.includes('--reopen') ? '.local/p1-reopen-report.json' : '.local/p1-host-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  if (page) await page.evaluate(() => { if (globalThis.__p1Process) { app.vault.process = __p1Process; delete globalThis.__p1Process; } }).catch(() => {});
  await browser.close();
}

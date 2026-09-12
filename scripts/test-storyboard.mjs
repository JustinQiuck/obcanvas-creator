import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const vault = resolve('.local/test-vault'), checks = [], calls = [];
const scriptText = '她提着打包的饭从地下停车场回到家。她走到房门前敲门：“吃饭了。”门内传来的急促呼吸声突然停住。';
let server, page, slow = false;
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347');
try {
  for (const candidate of browser.contexts().flatMap(context => context.pages())) if (await candidate.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => '') === vault) { page = candidate; break; }
  assert.ok(page, '必须匹配隔离测试资料库'); page.setDefaultTimeout(12000);
  await page.waitForFunction(() => app.workspace.layoutReady && !!app.plugins.plugins['obcanvas-creator']?.storyboards);
  await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
  const root = page.locator('.obcanvas-free').first(); await root.waitFor();
  const btn = name => root.getByRole('button', { name, exact: true });
  const idle = () => page.waitForFunction(() => !document.querySelector('.obcanvas-free-tools button')?.disabled && !app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().busy);
  const current = () => page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().selectedId);
  async function check(name, fn) { await fn(); checks.push(name); console.log('通过：' + name); }
  async function choose(id) { await btn('总览').click(); await root.locator(`[data-node-id="r:${id}"]`).click(); await root.getByRole('complementary', { name: '卡片详情' }).waitFor(); await idle(); }
  if (process.argv.includes('--reopen')) {
    const saved = JSON.parse(await readFile('.local/storyboard-checkpoint.json', 'utf8'));
    await check('完整重启后恢复分镜预览、人工修改与规则快照', async () => {
      await root.getByLabel('当前场次', { exact: true }).selectOption(saved.scene); await idle(); await choose(saved.script);
      const task = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.find(task => task.id === id), saved.taskId);
      assert.equal(task.items[0].intent, '人工确认：先让观众知道她正在逼近。');
      assert.ok(task.skill.prompt.includes('keyframePrompt'));
      assert.equal(await root.getByLabel('镜头 1 拍摄理由', { exact: true }).inputValue(), task.items[0].intent);
      assert.equal(await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.filter(record => record.kind === 'shot').length), saved.shotCount);
    });
  } else {
    const state = await page.evaluate(async text => {
      const plugin = app.plugins.plugins['obcanvas-creator'];
      const scene = await plugin.records.create('scene'); await plugin.records.save(scene, { title: 'DS01 · 回家', body: '' });
      const person = await plugin.records.create('person', scene.id); await plugin.records.save(person, { title: '回家的女人', body: '成年人，手提打包饭。' });
      const script = await plugin.records.create('script', scene.id); await plugin.records.save(script, { title: '交叉剪辑测试', body: text });
      await plugin.records.attachScriptAsset(await plugin.records.requireRecord(script.id), person.id);
      return { scene: scene.id, script: script.id, person: person.id };
    }, scriptText);
    server = createServer(async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push(body);
      if (slow) await new Promise(done => setTimeout(done, 1500));
      const shots = [
        {
          title: '停车场出口', evidence: '她提着打包的饭从地下停车场回到家。',
          intent: '建立她与家的距离，让观众知道逼近已经开始；全景用来读清出口和人物在空间中的位置。',
          framing: '竖屏全景，人物在纵深中景，出口位于背景。', camera: '固定低机位平视，不跟拍。',
          start: '她位于停车场车道中景，身体朝向出口，右手提打包饭。', action: '她走向出口。', end: '她抵达出口附近。',
          sound: '停车场环境声、脚步与饭盒轻碰声，无对白。',
          keyframePrompt: '竖屏 9:16 全景，固定低机位平视，前景停车线，中景成年女人身体朝出口、右手提打包饭，背景停车场出口，冷白顶灯，排除行走拖影和终点状态。',
          plannedDurationSeconds: 4,
        },
        {
          title: '门内骤静', evidence: '门内传来的急促呼吸声突然停住。',
          intent: '让声音的消失成为风险已经抵达门口的证据；用门把手特写把注意集中到唯一变化。',
          framing: '门把手与门缝细节特写，画面外不展示房内行为。', camera: '门外侧固定机位，平视门把手。',
          start: '门把手静止，门缝无人物，走廊光停在门外。', action: '画外急促呼吸声突然停止。', end: '门内恢复安静，门把手仍未转动。',
          sound: '画外急促呼吸声戛然而止，随后半秒安静。',
          keyframePrompt: '竖屏 9:16 门把手细节特写，门外侧固定平视机位，前景门框边缘，中景静止门把手，门缝无人物，走廊暖光从侧面落下，排除人物、转动过程和房内行为。',
          plannedDurationSeconds: 2,
        },
      ];
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ shots }) } }] }));
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done)); const url = `http://127.0.0.1:${server.address().port}/v1`;
    await page.evaluate(async ([baseUrl]) => { const plugin = app.plugins.plugins['obcanvas-creator']; await plugin.saveAISettings({ baseUrl, model: 'storyboard-simulator' }, 'storyboard-test-key'); }, [url]);
    await root.getByLabel('当前场次', { exact: true }).selectOption(state.scene); await idle(); await choose(state.script);
    await check('剧本卡显示分镜试点与已关联资产数量', async () => {
      await root.getByRole('heading', { name: '分镜与关键帧 · 试点', exact: true }).waitFor();
      assert.ok(await root.getByText('读取当前剧本和已关联的 1 项拍摄资产文字信息，帮你判断哪里该用特写、全景或固定机位。图片不会发送。', { exact: true }).isVisible());
    });
    await check('生成可编辑分镜预览，不创建正式镜头卡', async () => {
      const shotCount = await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.filter(record => record.kind === 'shot').length);
      await btn('生成分镜预览').click(); await page.waitForFunction(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.some(task => task.scriptId === id), state.script); await idle();
      assert.equal(await root.getByLabel(/镜头 \d+ 拍摄理由/).count(), 2); assert.equal(await root.getByLabel(/镜头 \d+ 静态起始关键帧提示词/).count(), 2);
      assert.ok(await root.getByText('当前只保存预览，不创建正式镜头卡。', { exact: false }).isVisible());
      assert.equal(await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.filter(record => record.kind === 'shot').length), shotCount);
      assert.ok(calls[0].messages[0].content.includes('不展示性器官、裸露细节或行为过程'));
      const context = JSON.parse(calls[0].messages[1].content); assert.equal(context.script.text, scriptText); assert.equal(context.assets.length, 1); assert.equal(context.assets[0].id, state.person);
      state.shotCount = shotCount;
    });
    await check('人工修改自动保存，规则与完整输出协议随任务留存', async () => {
      await root.getByLabel('镜头 1 拍摄理由', { exact: true }).fill('人工确认：先让观众知道她正在逼近。');
      await btn('保存分镜预览修改').click(); await idle();
      const task = await page.evaluate(id => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.find(task => task.scriptId === id), state.script);
      assert.equal(task.items[0].intent, '人工确认：先让观众知道她正在逼近。'); assert.ok(task.skill.prompt.includes('plannedDurationSeconds')); state.taskId = task.id;
    });
    await check('取消重新生成后保留旧预览且不落新任务', async () => {
      slow = true; const count = await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.length);
      await btn('重新生成分镜预览').click(); await btn('取消分镜设计').click(); await root.getByText('已取消本次请求。', { exact: true }).waitFor(); await idle();
      assert.equal(await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].storyboards.getSnapshot().tasks.length), count);
    });
    await page.evaluate(async () => { const plugin = app.plugins.plugins['obcanvas-creator']; await plugin.storyboards.flushDrafts(); await plugin.flushDrafts(); await plugin.layout.flush(); });
    await writeFile('.local/storyboard-checkpoint.json', JSON.stringify(state, null, 2));
  }
  await btn('总览').click(); await page.screenshot({ path: '.local/storyboard.png' });
  await writeFile('.local/storyboard-results' + (process.argv.includes('--reopen') ? '-reopen' : '') + '.json', JSON.stringify({ checks, simulatedInterface: true }, null, 2));
} catch (error) {
  if (page) { await page.screenshot({ path: '.local/storyboard-error.png' }).catch(() => {}); await writeFile('.local/storyboard-error.txt', await page.locator('body').innerText()).catch(() => {}); }
  throw error;
} finally { if (server) await new Promise(done => server.close(done)); await browser.close(); }

import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const expectedVault = resolve('.local/test-vault');
const browser = await chromium.connectOverCDP('http://127.0.0.1:19347');
let page;
const checks = [];
async function check(name, run) { await run(); checks.push(name); console.log('通过：' + name); }
try {
  for (const candidate of browser.contexts().flatMap(c => c.pages())) {
    if (await candidate.evaluate(() => globalThis.app?.vault?.adapter?.getBasePath?.()).catch(() => null) === expectedVault) { page = candidate; break; }
  }
  assert.ok(page, '只允许连接项目内的隔离测试资料库');
  page.setDefaultTimeout(7000);
  const checkpointPath = resolve('.local/p0-a-checkpoint.json');
  if (process.argv.includes('--reopen')) {
    const expected = JSON.parse(await readFile(checkpointPath, 'utf8'));
    await page.waitForFunction(() => !!app.plugins.plugins['obcanvas-creator']);
    await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView());
    const visible = page.locator('.obcanvas-root:visible');
    await visible.getByLabel('镜头标题', { exact: true }).waitFor();
    assert.equal(await visible.getByLabel('镜头标题', { exact: true }).inputValue(), expected.title);
    assert.equal(await visible.getByLabel('镜头内容', { exact: true }).inputValue(), expected.body);
    checks.push('完整退出并重新启动独立 Obsidian 后恢复保存内容');
    await check('原生笔记编辑器修改后同步回镜头卡', async () => {
      await visible.getByRole('button', { name: '打开对应笔记', exact: true }).click();
      await page.waitForFunction(() => !!app.workspace.activeEditor?.editor);
      const suffix = '\n\n原生笔记编辑器补充：门外传来脚步声。';
      await page.evaluate(suffix => {
        const editor = app.workspace.activeEditor.editor;
        editor.setValue(editor.getValue() + suffix);
      }, suffix);
      await page.waitForFunction(body => document.querySelector('.obcanvas-root textarea')?.value === body, expected.body + suffix);
      expected.body += suffix;
      await writeFile(checkpointPath, JSON.stringify(expected, null, 2));
    });
    await page.screenshot({ path: '.local/p0-a-reopened.png' });
  } else {
    await check('加载中文视图且不重复挂载', async () => {
      await page.evaluate(async () => { await app.plugins.plugins['obcanvas-creator'].openView(); await app.plugins.plugins['obcanvas-creator'].openView(); });
      await page.getByRole('heading', { name: '影视画布', exact: true }).waitFor();
      assert.equal(await page.locator('.obcanvas-root').count(), 1);
    });
    await check('从中文界面新建场次、镜头并保存', async () => {
      await page.getByRole('button', { name: '新建场次', exact: true }).click();
      await page.getByRole('button', { name: '添加镜头', exact: true }).click();
      await page.getByLabel('镜头标题', { exact: true }).fill('走廊里的脚步');
      await page.getByLabel('镜头内容', { exact: true }).fill('中性测试：人物从走廊经过，固定镜头记录脚步。');
      await page.getByRole('button', { name: '保存到笔记', exact: true }).click();
      await page.locator('[data-save-status="saved"]').waitFor();
    });
    let record = await page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().base);
    const notePath = resolve(expectedVault, record.path);
    await check('外部文件修改进入视图，未知属性和正文保留', async () => {
      let source = await readFile(notePath, 'utf8');
      assert.ok(source.includes('走廊里的脚步'));
      source = source.replace('---\n', '---\n# 验收注释\nowner: 保留外部字段\n') + '\n\n外部补充：测试文件修改通知。';
      await writeFile(notePath, source);
      await page.waitForFunction(() => document.querySelector('.obcanvas-root textarea')?.value.includes('外部补充'));
      await page.getByLabel('镜头标题', { exact: true }).fill('外部笔记与镜头同步');
      await page.getByRole('button', { name: '保存到笔记', exact: true }).click();
      await page.locator('[data-save-status="saved"]').waitFor();
      const saved = await readFile(notePath, 'utf8');
      assert.ok(saved.includes('# 验收注释') && saved.includes('owner: 保留外部字段') && saved.includes('外部补充'));
    });
    await check('两个真实视图的同字段冲突可见且不覆盖输入', async () => {
      await page.evaluate(() => app.plugins.plugins['obcanvas-creator'].openView(true));
      await page.waitForFunction(() => app.workspace.getLeavesOfType('obcanvas-film-view').length === 2);
      await page.evaluate(id => app.workspace.getLeavesOfType('obcanvas-film-view')[1].view.editor.select(id), record.id);
      const second = page.locator('.obcanvas-root:visible');
      await second.getByLabel('镜头标题', { exact: true }).fill('第二个视图的修改');
      await page.evaluate(async () => { const editor = app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor; editor.edit('title', '第一个视图已保存'); await editor.save(); });
      await second.getByRole('button', { name: '保存到笔记', exact: true }).click();
      await second.locator('[data-save-status="conflict"]').waitFor();
      assert.equal(await second.getByLabel('镜头标题', { exact: true }).inputValue(), '第二个视图的修改');
      await second.getByRole('button', { name: '放弃本地修改，载入笔记', exact: true }).click();
      assert.equal(await second.getByLabel('镜头标题', { exact: true }).inputValue(), '第一个视图已保存');
    });
    await check('真实 Vault 保存失败、关闭视图恢复草稿、重试成功', async () => {
      await page.evaluate(target => {
        globalThis.__obcanvasOriginalProcess = app.vault.process;
        app.vault.process = function(file, fn, options) { if (file.path === target) return Promise.reject(new Error('测试：模拟磁盘写入失败')); return globalThis.__obcanvasOriginalProcess.call(this, file, fn, options); };
      }, record.path);
      const visible = page.locator('.obcanvas-root:visible');
      await visible.getByLabel('镜头内容', { exact: true }).fill('磁盘失败时也要保留的草稿。');
      await visible.getByRole('button', { name: '保存到笔记', exact: true }).click();
      await visible.locator('[data-save-status="error"]').waitFor();
      await page.evaluate(async () => {
        app.workspace.getLeavesOfType('obcanvas-film-view')[1].detach();
        await app.plugins.plugins['obcanvas-creator'].flushDrafts();
        app.vault.process = globalThis.__obcanvasOriginalProcess; delete globalThis.__obcanvasOriginalProcess;
        await app.plugins.plugins['obcanvas-creator'].openView(true);
      });
      await page.waitForFunction(() => [...document.querySelectorAll('.obcanvas-root textarea')].some(el => el.value === '磁盘失败时也要保留的草稿。'));
      assert.equal(await page.locator('.obcanvas-root:visible').getByLabel('镜头内容', { exact: true }).inputValue(), '磁盘失败时也要保留的草稿。');
      await page.locator('.obcanvas-root:visible').getByRole('button', { name: '保存到笔记', exact: true }).click();
      await page.locator('.obcanvas-root:visible [data-save-status="saved"]').waitFor();
    });
    await check('资料库改名后继续按稳定编号保存', async () => {
      await page.evaluate(async id => {
        const plugin = app.plugins.plugins['obcanvas-creator'];
        const record = plugin.records.getSnapshot().records.find(r => r.id === id);
        const file = app.vault.getAbstractFileByPath(record.path);
        await app.fileManager.renameFile(file, `影视项目/改名后的镜头-${id}.md`);
      }, record.id);
      await page.waitForFunction(id => app.workspace.getLeavesOfType('obcanvas-film-view')[1].view.editor.getSnapshot().base?.path === `影视项目/改名后的镜头-${id}.md`, record.id);
      await page.locator('.obcanvas-root:visible').getByLabel('镜头标题', { exact: true }).fill('重开后仍能继续的镜头');
      await page.locator('.obcanvas-root:visible').getByRole('button', { name: '保存到笔记', exact: true }).click();
      await page.locator('.obcanvas-root:visible [data-save-status="saved"]').waitFor();
    });
    await check('禁用与重载插件会卸载视图并恢复已保存内容', async () => {
      await page.evaluate(async () => { await app.plugins.unloadPlugin('obcanvas-creator'); });
      assert.equal(await page.locator('.obcanvas-root').count(), 0);
      await page.evaluate(async () => { await app.plugins.loadPlugin('obcanvas-creator'); await app.plugins.plugins['obcanvas-creator'].openView(); });
      await page.getByLabel('镜头标题', { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('.obcanvas-root input')?.value === '重开后仍能继续的镜头');
    });
    await check('未知版本草稿阻止加载并保留原始备份文件', async () => {
      await page.evaluate(async () => {
        const plugin = app.plugins.plugins['obcanvas-creator'];
        await app.plugins.unloadPlugin('obcanvas-creator');
        await plugin.flushDrafts();
      });
      const backupPath = resolve(expectedVault, '.obsidian/plugins/obcanvas-creator/data.json');
      const original = await readFile(backupPath, 'utf8');
      const unsupported = JSON.stringify({ version: 999, drafts: [] });
      try {
        await page.evaluate(value => app.vault.adapter.write('.obsidian/plugins/obcanvas-creator/data.json', value), unsupported);
        await page.evaluate(async () => { try { await app.plugins.loadPlugin('obcanvas-creator'); } catch {} });
        assert.equal(await readFile(backupPath, 'utf8'), unsupported);
        assert.notEqual(await page.evaluate(() => app.plugins.plugins['obcanvas-creator']?.ready), true);
      } finally {
        await page.evaluate(async value => { await app.plugins.unloadPlugin('obcanvas-creator'); await app.vault.adapter.write('.obsidian/plugins/obcanvas-creator/data.json', value); await app.plugins.loadPlugin('obcanvas-creator'); await app.plugins.plugins['obcanvas-creator'].openView(); }, original);
      }
      await page.getByLabel('镜头标题', { exact: true }).waitFor();
    });
    await page.evaluate(id => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.select(id), record.id);
    record = await page.evaluate(() => app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().base);
    await writeFile(checkpointPath, JSON.stringify({ id: record.id, title: record.title, body: record.body, path: record.path }, null, 2));
    await page.screenshot({ path: '.local/p0-a-host.png' });
  }
  const report = { title: await page.title(), vault: expectedVault, checks, result: 'PASS' };
  await writeFile(process.argv.includes('--reopen') ? '.local/p0-a-reopen-report.json' : '.local/p0-a-host-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (page) await page.evaluate(() => { if (globalThis.__obcanvasOriginalProcess) { app.vault.process = globalThis.__obcanvasOriginalProcess; delete globalThis.__obcanvasOriginalProcess; } }).catch(() => {});
  await browser.close();
}

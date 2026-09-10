import { mkdir, copyFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve('.local/test-vault');
const plugin = join(root, '.obsidian/plugins/obcanvas-creator');
await mkdir(plugin, { recursive: true });
for (const name of ['manifest.json', 'main.js', 'styles.css']) await copyFile(name, join(plugin, name));
// 仅在首次创建时写入测试库配置，重装插件保留笔记、草稿和工作区。
async function initial(relative, content) {
  const path = join(root, relative);
  try { await access(path); } catch { await writeFile(path, content); }
}
await initial('.obsidian/community-plugins.json', '["obcanvas-creator"]\n');
await initial('.obsidian/app.json', '{"safeMode":false}\n');
await initial('.obsidian/appearance.json', '{"theme":"obsidian"}\n');
await initial('接入测试说明.md', '# 影视画布接入测试\n\n这是独立测试资料库。请通过“打开影视画布”创建中性场次和镜头。\n');
console.log(`测试库已准备：${root}`);

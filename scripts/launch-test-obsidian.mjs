// macOS 实机验收入口。所有实例配置、资料库和日志都限定在 .local 内。
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, readdir, access, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openSync, closeSync } from 'node:fs';
if (process.platform !== 'darwin') throw new Error('该启动脚本当前只验证过 macOS。');
const app = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const profile = resolve('.local/obsidian-profile');
const vault = resolve('.local/test-vault');
const pidFile = resolve('.local/obsidian-test.pid');
await access(join(vault, '.obsidian/plugins/obcanvas-creator/main.js'));
await access(app);
await mkdir(profile, { recursive: true });
let prior;
try { prior = Number(await readFile(pidFile, 'utf8')); } catch {}
if (prior) {
  let command = '';
  try { command = execFileSync('ps', ['-p', String(prior), '-o', 'args='], { encoding: 'utf8' }); } catch {}
  if (command) {
    if (!command.includes(`--user-data-dir=${profile}`)) throw new Error('记录的进程不属于本项目测试实例，停止操作。');
    if (!process.argv.includes('--restart') && !process.argv.includes('--stop')) throw new Error('测试实例已运行；需要重启时显式传入 --restart。');
    process.kill(prior, 'SIGTERM');
    let stopped = false;
    for (let i = 0; i < 50; i++) { try { process.kill(prior, 0); } catch { stopped = true; break; } await delay(100); }
    if (!stopped) throw new Error('测试进程尚未退出，停止启动。');
  }
}
if (process.argv.includes('--stop')) { await rm(pidFile, { force: true }); console.log('独立测试实例已停止。'); process.exit(0); }
// 只复制本机已有的 Obsidian 程序更新包，不读取或复制私人资料库配置。
const updates = join(homedir(), 'Library/Application Support/obsidian');
const packages = (await readdir(updates)).filter(name => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(name));
packages.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
if (packages[0]) await copyFile(join(updates, packages[0]), join(profile, packages[0]));
const configFile = join(profile, 'obsidian.json');
try { await access(configFile); } catch {
  const id = createHash('sha256').update(vault).digest('hex').slice(0, 16);
  await writeFile(configFile, JSON.stringify({ vaults: { [id]: { path: vault, ts: Date.now(), open: true } } }));
}
const log = openSync(resolve('.local/obsidian-test.log'), 'a');
const child = spawn(app, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=19347'], { detached: true, stdio: ['ignore', log, log] });
closeSync(log);
child.unref();
await writeFile(pidFile, String(child.pid));
for (let i = 0; i < 50; i++) {
  try { const response = await fetch('http://127.0.0.1:19347/json/version'); if (response.ok) { console.log(`隔离测试实例已启动，PID ${child.pid}`); process.exit(0); } } catch {}
  await delay(100);
}
throw new Error('调试端口未就绪，请检查 .local/obsidian-test.log。');

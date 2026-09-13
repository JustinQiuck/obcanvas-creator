// Explicit opt-in real text-model probe. Outputs are local, never credentials.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ChatClient } from '../src/ai/chat-client';
import { storyboardPrompt } from '../src/ai/storyboard-skill';
import { parseStoryboardSuggestions } from '../src/ai/storyboard-model';
import type { FilmRecord } from '../src/model';

const baseUrl = process.env.OBCANVAS_QUALITY_BASE_URL, model = process.env.OBCANVAS_QUALITY_MODEL;
if (!baseUrl || !model || !process.argv.includes('--run')) throw new Error('显式传入 --run，并设置 OBCANVAS_QUALITY_BASE_URL / MODEL；密钥仅通过 OBCANVAS_QUALITY_KEY 环境变量传入。');
const folder = resolve('.local', `storyboard-quality-${Date.now()}`);
await mkdir(folder, { recursive: true });
const instructions = await readFile('skills/drama-storyboard/SKILL.md', 'utf8');
const scripts = [
  { id: 'approach', title: '两个空间的惊喜', text: '成年小林在餐厅里准备生日惊喜。餐桌上放着一个未点燃蜡烛的小蛋糕，门关闭。小林站在餐桌旁，右手拿着打火机，左手空着。与此同时，成年阿宁提着晚饭从楼道走向家门。小林点燃蜡烛，随后把打火机放到桌上。阿宁在门外停住，左手提着晚饭，右手敲门，说：“我回来了。”小林听见敲门声，双手停在桌边，没有开门。阿宁仍在门外等待。' },
  { id: 'handover', title: '文件交接', text: '资料室内，两名成年人小周和老陈隔着桌子相对而坐。小周右手握着一个蓝色文件袋，老陈双手放在桌上。小周说：“原件都在里面。”他把文件袋放到桌面中央，右手离开文件袋。老陈看着文件袋，停顿两秒，说：“你确定没有留备份？”小周没有回答，视线从文件袋移到老陈脸上。老陈伸出右手，把文件袋拉到自己面前，左手仍放在桌上。' },
];
const client = new ChatClient(async request => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: AbortSignal.timeout(120000) });
  return { status: response.status, text: await response.text() };
});
const summary: { caseId: string; method: string; elapsedMs: number; shots?: number; issues?: string[]; error?: string }[] = [];
console.log(`输出目录：${folder}`);
for (const sample of scripts) for (const method of process.argv.includes('--adapted-only') ? ['adapted'] : ['baseline', 'adapted']) {
  const script: FilmRecord = { id: sample.id, kind: 'script', version: 1, title: sample.title, body: sample.text, sceneId: 'quality-scene', path: '' };
  const skill = { id: method, name: method, stage: 'storyboard' as const, version: 'quality-1', instructions: method === 'adapted' ? instructions : '请根据剧本设计可拍摄分镜与静态起始关键帧。保留事实与对白，说明镜头理由，不补写未给定剧情。' };
  const messages = [{ role: 'system' as const, content: storyboardPrompt(skill) }, { role: 'user' as const, content: JSON.stringify({ script: { title: sample.title, text: sample.text }, assets: [] }) }];
  const started = Date.now();
  try {
    const raw = await client.complete({ baseUrl, model }, process.env.OBCANVAS_QUALITY_KEY ?? '', messages, new AbortController().signal);
    // Retain even invalid content as review evidence, without request headers.
    await writeFile(resolve(folder, `${sample.id}-${method}.json`), JSON.stringify({ model, messages, raw, elapsedMs: Date.now() - started }, null, 2));
    const result = parseStoryboardSuggestions(raw, script);
    summary.push({ caseId: sample.id, method, elapsedMs: Date.now() - started, shots: result.items.length, issues: result.issues });
    console.log(`${sample.id} / ${method}：${result.items.length} 镜，${result.issues.length} 项结构问题；创作评分待审阅。`);
  } catch (error) {
    summary.push({ caseId: sample.id, method, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : '请求失败' });
    await writeFile(resolve(folder, 'summary.json'), JSON.stringify({ model, summary, qualityPassed: false }, null, 2));
    throw new Error('真实小样未完成，已保留安全错误摘要；未自动重试。');
  }
  await writeFile(resolve(folder, 'summary.json'), JSON.stringify({ model, summary, qualityPassed: false, note: '结构检查不代表创作评分通过。' }, null, 2));
}

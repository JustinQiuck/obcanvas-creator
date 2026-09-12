import { assetDetails, isProductionAsset, type FilmRecord } from '../model';
import { taskIdValid } from './extraction-model';
import type { StoryboardSkill } from './storyboard-skill';

export type StoryboardItem = {
  id: string;
  title: string;
  evidence: string;
  intent: string;
  framing: string;
  camera: string;
  start: string;
  action: string;
  end: string;
  sound: string;
  keyframePrompt: string;
  plannedDurationSeconds: number;
};

export type StoryboardTask = {
  version: 1;
  id: string;
  revision: number;
  scriptId: string;
  sceneId: string;
  inputVersion: string;
  scriptText: string;
  createdAt: string;
  model: string;
  skill: StoryboardSkill & { prompt: string };
  status: 'review';
  items: StoryboardItem[];
  issues?: string[];
};

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, limit: number, empty = false): v is string => typeof v === 'string' && v.length <= limit && (empty || !!v.trim());

export function storyboardAssets(script: FilmRecord, records: FilmRecord[]) {
  const ids = new Set((script.links ?? []).filter(link => link.role === '拍摄资产' && link.from.startsWith('r:')).map(link => link.from.slice(2)));
  return records.filter(record => ids.has(record.id) && isProductionAsset(record));
}

function assetSummary(record: FilmRecord) {
  const details = assetDetails(record);
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    description: record.body,
    unresolved: details.unresolved,
    needs: details.needs,
    confirmedReferencePurposes: [...new Set((record.media ?? []).filter(media => media.confirmed).map(media => media.purpose).filter((purpose): purpose is string => !!purpose))],
  };
}

function storyboardSource(script: FilmRecord, records: FilmRecord[]) {
  if (script.kind !== 'script' || !script.body.trim()) throw new Error('请先填写并保存剧本。');
  const assets = storyboardAssets(script, records).map(assetSummary);
  return { script: { title: script.title, text: script.body }, assets };
}

export function storyboardContext(script: FilmRecord, records: FilmRecord[]) {
  const source = storyboardSource(script, records);
  const content = JSON.stringify(source);
  if (script.body.length > 40000 || content.length > 80000) throw new Error('本次内容过长，请缩小剧本范围或整理已关联资产描述后重试；没有发送或截断内容。');
  return content;
}

export async function storyboardInputVersion(script: FilmRecord, records: FilmRecord[]) {
  const source = storyboardSource(script, records);
  const bytes = new TextEncoder().encode(JSON.stringify([script.id, script.sceneId, source]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function originalEvidence(body: string, quote: string): string | undefined {
  const trimmed = quote.trim();
  if (body.includes(trimmed)) return trimmed;
  const offsets: number[] = [];
  let compact = '';
  for (let index = 0; index < body.length; index++) if (!/\s/.test(body[index]!)) { compact += body[index]; offsets.push(index); }
  const needle = trimmed.replace(/\s/g, '');
  if (!needle) return undefined;
  const start = compact.indexOf(needle);
  if (start < 0) return undefined;
  const original = body.slice(offsets[start], offsets[start + needle.length - 1]! + 1);
  return original.length <= 3000 ? original : undefined;
}

export function parseStoryboardSuggestions(raw: string, script: FilmRecord): { items: StoryboardItem[]; issues: string[] } {
  if (raw.length > 400000) throw new Error('分镜结果过长，请缩小本次剧本范围。');
  let data: unknown;
  try { data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')); }
  catch { throw new Error('模型没有返回有效 JSON 分镜。请检查所选模型是否支持结构化文字输出，再重新生成；原项目未改动。'); }
  if (!obj(data) || !Array.isArray(data.shots) || data.shots.length > 60) throw new Error('模型返回的 shots 必须是最多 60 项的分镜列表，请检查模型后重新生成。');
  const items: StoryboardItem[] = [];
  const issues: string[] = [];
  data.shots.forEach((value, index) => {
    const fail = (reason: string) => issues.push(`第 ${index + 1} 镜${obj(value) && text(value.title, 250) ? `「${value.title.trim()}」` : ''}：${reason}`);
    if (!obj(value)) { fail('条目不是分镜对象。'); return; }
    if (!text(value.title, 250)) { fail('镜头名称缺失或超过 250 字。'); return; }
    if (!text(value.evidence, 3000)) { fail('缺少有效的剧本原文依据，或依据超过 3000 字。'); return; }
    const evidence = originalEvidence(script.body, value.evidence);
    if (!evidence) { fail('原文依据在剧本中找不到；需要连续原句，不能改写、拼接或省略。'); return; }
    const fields = ['intent', 'framing', 'camera', 'start', 'action', 'end', 'sound', 'keyframePrompt'] as const;
    const missing = fields.find(field => !text(value[field], 6000));
    if (missing) { fail(`字段 ${missing} 缺失、为空或超过 6000 字。`); return; }
    if (typeof value.plannedDurationSeconds !== 'number' || !Number.isFinite(value.plannedDurationSeconds) || value.plannedDurationSeconds <= 0 || value.plannedDurationSeconds > 120) { fail('成片计划时长必须是大于 0 且不超过 120 的数字。'); return; }
    items.push({ id: crypto.randomUUID(), title: value.title.trim(), evidence, intent: value.intent as string, framing: value.framing as string, camera: value.camera as string, start: value.start as string, action: value.action as string, end: value.end as string, sound: value.sound as string, keyframePrompt: value.keyframePrompt as string, plannedDurationSeconds: value.plannedDurationSeconds });
  });
  return { items, issues };
}

function validSkill(value: unknown): value is StoryboardTask['skill'] {
  return obj(value) && text(value.id, 100) && text(value.name, 100) && value.stage === 'storyboard' && text(value.version, 100) && text(value.instructions, 20000) && text(value.prompt, 30000);
}

export function parseStoryboardTask(raw: string): StoryboardTask {
  const value: unknown = JSON.parse(raw);
  if (!obj(value) || value.version !== 1 || !taskIdValid(value.id) || !Number.isInteger(value.revision) || (value.revision as number) < 0 || !text(value.scriptId, 500) || !text(value.sceneId, 500) || typeof value.inputVersion !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputVersion) || !text(value.scriptText, 40000) || !text(value.createdAt, 100) || !text(value.model, 250) || value.status !== 'review' || !validSkill(value.skill) || !Array.isArray(value.items) || value.items.length > 60) throw new Error('分镜预览草稿格式损坏，已保留原文件。');
  if (value.issues !== undefined && (!Array.isArray(value.issues) || value.issues.length > 60 || !value.issues.every(issue => text(issue, 1000)))) throw new Error('分镜预览问题记录格式损坏，已保留原文件。');
  for (const item of value.items) {
    if (!obj(item) || !taskIdValid(item.id) || !text(item.title, 250) || !text(item.evidence, 3000) || !(value.scriptText as string).includes(item.evidence) || !['intent', 'framing', 'camera', 'start', 'action', 'end', 'sound', 'keyframePrompt'].every(field => text(item[field], 6000)) || typeof item.plannedDurationSeconds !== 'number' || !Number.isFinite(item.plannedDurationSeconds) || item.plannedDurationSeconds <= 0 || item.plannedDurationSeconds > 120) throw new Error('分镜预览条目格式损坏，已保留原文件。');
  }
  if (new Set(value.items.map(item => item.id)).size !== value.items.length) throw new Error('分镜预览草稿含有重复编号。');
  return value as StoryboardTask;
}

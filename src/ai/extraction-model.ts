import { validAssetSkill, type AssetSkill } from './skill-model';
import { isProductionAsset, productionKinds, type FilmRecord, type ProductionKind } from '../model';

export type AssetItem = {
  id: string; kind: ProductionKind; title: string; description: string;
  evidence: string; unresolved: string[]; needs: string[];
  action: 'create' | 'reuse' | 'ignore'; targetId: string; applied: boolean;
};
export type ExtractionTask = {
  version: 1; id: string; revision: number; scriptId: string; sceneId: string;
  inputVersion: string; scriptText: string; createdAt: string; model: string;
  skillVersion: string; skill?: AssetSkill & { prompt: string }; status: 'review' | 'applying' | 'partial' | 'complete';
  items: AssetItem[]; issues?: string[];
};
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, limit: number, empty = false): v is string => typeof v === 'string' && v.length <= limit && (empty || !!v.trim());
const list = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 50 && v.every(s => text(s, 1000));
export const taskIdValid = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(v);
export async function inputVersion(script: FilmRecord) {
  const bytes = new TextEncoder().encode(JSON.stringify([script.id, script.sceneId, script.title, script.body]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export function extractionContext(script: FilmRecord, records: FilmRecord[]) {
  if (script.kind !== 'script' || !script.body.trim()) throw new Error('请先填写并保存剧本。');
  const existing = records.filter(isProductionAsset).map(r => ({ id: r.id, kind: r.kind, title: r.title, description: r.body }));
  const content = JSON.stringify({ script: { title: script.title, text: script.body }, existing });
  if (script.body.length > 40000 || content.length > 80000) throw new Error('本次内容过长，请缩小剧本范围或整理已有资产描述后重试；没有发送或截断内容。');
  return content;
}
// Match formatting-only differences, then retain the exact original substring.
function originalEvidence(body: string, quote: string): string | undefined {
  const trimmed = quote.trim();
  if (body.includes(trimmed)) return trimmed;
  const offsets: number[] = [];
  let compact = '';
  for (let i = 0; i < body.length; i++) if (!/\s/.test(body[i]!)) { compact += body[i]; offsets.push(i); }
  const needle = trimmed.replace(/\s/g, '');
  if (!needle) return undefined;
  const start = compact.indexOf(needle);
  if (start < 0) return undefined;
  const original = body.slice(offsets[start], offsets[start + needle.length - 1]! + 1);
  return original.length <= 3000 ? original : undefined;
}
export function parseSuggestions(raw: string, script: FilmRecord, existing: FilmRecord[]): { items: AssetItem[]; issues: string[] } {
  if (raw.length > 200000) throw new Error('提取结果过长，请缩小本次剧本范围。');
  let data: unknown;
  try { data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')); }
  catch { throw new Error('模型没有返回有效 JSON 清单。请检查所选模型是否支持结构化文字输出，再重新整理；原项目未改动。'); }
  if (!obj(data) || !Array.isArray(data.assets) || data.assets.length > 100) throw new Error('模型返回的 assets 必须是最多 100 项的资产列表，请检查模型后重新整理。');
  const items: AssetItem[] = [], issues: string[] = [];
  data.assets.forEach((v, index) => {
    const fail = (reason: string) => { issues.push(`第 ${index + 1} 项${obj(v) && text(v.title, 250) ? `「${v.title.trim()}」` : ''}：${reason}`); };
    if (!obj(v)) { fail('条目不是资产对象。'); return; }
    if (!(productionKinds as readonly unknown[]).includes(v.kind)) { fail('资产类型必须为 person（人物）、setting（场景）或 prop（道具）。'); return; }
    if (!text(v.title, 250)) { fail('名称缺失或超过 250 字。'); return; }
    const description = v.description ?? '', unresolved = v.unresolved ?? [];
    if (!text(description, 6000, true)) { fail('描述必须是最多 6000 字的文字。'); return; }
    if (!text(v.evidence, 3000)) { fail('缺少有效的剧本原文依据，或依据超过 3000 字。'); return; }
    const evidence = originalEvidence(script.body, v.evidence);
    if (!evidence) { fail('原文依据在剧本中找不到；需要连续原句，不能改写、拼接或省略。'); return; }
    if (!list(unresolved)) { fail('待确认信息必须是文字列表，暂无问题时可为空。'); return; }
    const needs = typeof v.needs === 'string' ? [v.needs] : v.needs;
    if (!list(needs) || !needs.length) { fail('缺少有效的参考用途，例如「主参考」或「空间全景」。'); return; }
    const reuse = typeof v.existingId === 'string' && v.existingId ? existing.find(r => r.id === v.existingId && r.kind === v.kind && isProductionAsset(r)) : undefined;
    if (v.existingId && !reuse) { fail('引用的已有资产不存在或类型不符。'); return; }
    const exact = existing.filter(r => r.kind === v.kind && r.title.trim() === (v.title as string).trim());
    const candidate = reuse ?? (exact.length === 1 ? exact[0] : undefined);
    items.push({ id: crypto.randomUUID(), kind: v.kind as ProductionKind, title: v.title.trim(), description, evidence, unresolved, needs: [...new Set(needs.map(s => s.trim()))], action: candidate ? 'reuse' : 'create', targetId: candidate?.id ?? crypto.randomUUID(), applied: false });
  });
  return { items, issues };
}
export function parseTask(raw: string): ExtractionTask {
  const v: unknown = JSON.parse(raw);
  if (!obj(v) || v.version !== 1 || !taskIdValid(v.id) || !Number.isInteger(v.revision) || (v.revision as number) < 0 || !text(v.scriptId, 500) || !text(v.sceneId, 500) || !text(v.inputVersion, 64) || !text(v.scriptText, 40000) || !text(v.createdAt, 100) || !text(v.model, 250) || !text(v.skillVersion, 100) || !['review', 'applying', 'partial', 'complete'].includes(v.status as string) || !Array.isArray(v.items) || v.items.length > 100) throw new Error('资产整理草稿格式损坏，已保留原文件。');
  if (v.skill !== undefined && (!validAssetSkill(v.skill) || !text((v.skill as Record<string, unknown>).prompt, 30000) || v.skill.version !== v.skillVersion)) throw new Error('清单的 Skill 记录无效，原文件已保留。');
  if (v.issues !== undefined && (!Array.isArray(v.issues) || v.issues.length > 100 || !v.issues.every(s => text(s, 1000)))) throw new Error('资产整理问题记录格式损坏，已保留原文件。');
  for (const item of v.items) {
    if (!obj(item) || !taskIdValid(item.id) || !(productionKinds as readonly unknown[]).includes(item.kind) || !text(item.title, 250) || !text(item.description, 6000, true) || !text(item.evidence, 3000) || !(v.scriptText as string).includes(item.evidence) || !list(item.unresolved) || !list(item.needs) || !item.needs.length || !['create', 'reuse', 'ignore'].includes(item.action as string) || !text(item.targetId, 500) || (item.action === 'create' && !taskIdValid(item.targetId)) || typeof item.applied !== 'boolean') throw new Error('资产整理条目格式损坏，已保留原文件。');
  }
  if (new Set(v.items.map(i => i.id)).size !== v.items.length || new Set(v.items.filter(i => i.action === 'create').map(i => i.targetId)).size !== v.items.filter(i => i.action === 'create').length) throw new Error('资产整理草稿含有重复编号。');
  return v as ExtractionTask;
}

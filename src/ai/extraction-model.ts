import { isProductionAsset, productionKinds, type FilmRecord, type ProductionKind } from '../model';

export type AssetItem = {
  id: string; kind: ProductionKind; title: string; description: string;
  evidence: string; unresolved: string[]; needs: string[];
  action: 'create' | 'reuse' | 'ignore'; targetId: string; applied: boolean;
};
export type ExtractionTask = {
  version: 1; id: string; revision: number; scriptId: string; sceneId: string;
  inputVersion: string; scriptText: string; createdAt: string; model: string;
  skillVersion: string; status: 'review' | 'applying' | 'partial' | 'complete';
  items: AssetItem[];
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
export function parseSuggestions(raw: string, script: FilmRecord, existing: FilmRecord[]): AssetItem[] {
  if (raw.length > 200000) throw new Error('提取结果过长，请缩小本次剧本范围。');
  let data: unknown;
  try { data = JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1')); }
  catch { throw new Error('模型没有返回有效的资产清单，请重新整理；原项目未改动。'); }
  if (!obj(data) || !Array.isArray(data.assets) || data.assets.length > 100) throw new Error('资产清单格式无效或超出单次处理范围。');
  return data.assets.map((v): AssetItem => {
    if (!obj(v) || !(productionKinds as readonly unknown[]).includes(v.kind) || !text(v.title, 250) || !text(v.description, 6000, true) || !text(v.evidence, 3000) || !script.body.includes(v.evidence) || !list(v.unresolved) || !list(v.needs) || !v.needs.length) throw new Error('资产信息或剧本依据无效，请重新整理；未创建正式卡片。');
    const reuse = typeof v.existingId === 'string' && v.existingId ? existing.find(r => r.id === v.existingId && r.kind === v.kind && isProductionAsset(r)) : undefined;
    if (v.existingId && !reuse) throw new Error('模型引用了不存在或类型不符的资产，请重新整理。');
    const exact = existing.filter(r => r.kind === v.kind && r.title.trim() === (v.title as string).trim());
    const candidate = reuse ?? (exact.length === 1 ? exact[0] : undefined);
    return { id: crypto.randomUUID(), kind: v.kind as ProductionKind, title: v.title.trim(), description: v.description, evidence: v.evidence, unresolved: v.unresolved, needs: [...new Set(v.needs)], action: candidate ? 'reuse' : 'create', targetId: candidate?.id ?? crypto.randomUUID(), applied: false };
  });
}
export function parseTask(raw: string): ExtractionTask {
  const v: unknown = JSON.parse(raw);
  if (!obj(v) || v.version !== 1 || !taskIdValid(v.id) || !Number.isInteger(v.revision) || (v.revision as number) < 0 || !text(v.scriptId, 500) || !text(v.sceneId, 500) || !text(v.inputVersion, 64) || !text(v.scriptText, 40000) || !text(v.createdAt, 100) || !text(v.model, 250) || !text(v.skillVersion, 100) || !['review', 'applying', 'partial', 'complete'].includes(v.status as string) || !Array.isArray(v.items) || v.items.length > 100) throw new Error('资产整理草稿格式损坏，已保留原文件。');
  for (const item of v.items) {
    if (!obj(item) || !taskIdValid(item.id) || !(productionKinds as readonly unknown[]).includes(item.kind) || !text(item.title, 250) || !text(item.description, 6000, true) || !text(item.evidence, 3000) || !(v.scriptText as string).includes(item.evidence) || !list(item.unresolved) || !list(item.needs) || !item.needs.length || !['create', 'reuse', 'ignore'].includes(item.action as string) || !text(item.targetId, 500) || (item.action === 'create' && !taskIdValid(item.targetId)) || typeof item.applied !== 'boolean') throw new Error('资产整理条目格式损坏，已保留原文件。');
  }
  if (new Set(v.items.map(i => i.id)).size !== v.items.length || new Set(v.items.filter(i => i.action === 'create').map(i => i.targetId)).size !== v.items.filter(i => i.action === 'create').length) throw new Error('资产整理草稿含有重复编号。');
  return v as ExtractionTask;
}

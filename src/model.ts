import { isMap, isSeq, parseDocument, stringify } from 'yaml';

export const recordKinds = ['project', 'scene', 'shot', 'script', 'person', 'setting', 'prop', 'frame', 'asset'] as const;
export type RecordKind = typeof recordKinds[number];
export const kindLabels: Record<RecordKind, string> = { project: '剧本项目', scene: '场次', shot: '镜头', script: '剧本', person: '人物', setting: '场景', prop: '道具', frame: '关键帧', asset: '素材' };
export const LEGACY_PROJECT_ID = 'legacy-project';
export function projectOf(record: FilmRecord, records: FilmRecord[] = []): string {
  return record.kind === 'project' ? record.id : record.projectId ?? records.find(r => r.kind === 'scene' && r.id === record.sceneId)?.projectId ?? LEGACY_PROJECT_ID;
}
export function projectRecords(records: FilmRecord[], projectId: string) { return records.filter(r => r.kind !== 'project' && projectOf(r, records) === projectId); }
export function filmProjects(records: FilmRecord[]): FilmRecord[] {
  const projects = records.filter(r => r.kind === 'project');
  if (!projects.some(r => r.id === LEGACY_PROJECT_ID) && records.some(r => r.kind !== 'project' && projectOf(r, records) === LEGACY_PROJECT_ID)) projects.unshift({ id: LEGACY_PROJECT_ID, kind: 'project', version: 1, title: '原有剧本项目', body: '', path: '' });
  return projects;
}
export const linkRoles = ['参考', '剧情拆分', '人物参考', '场景参考', '道具参考', '拍摄资产', '起始帧'] as const;
export type CardLink = { id: string; from: string; role: typeof linkRoles[number] };
export type MediaRef = { id: string; path: string; decision?: 'candidate' | 'adopted' | 'rejected'; reason?: string; purpose?: string; confirmed?: boolean; fingerprint?: string };
export const productionKinds = ['person', 'setting', 'prop'] as const;
export type ProductionKind = typeof productionKinds[number];
export function isProductionAsset(record: FilmRecord) { return (productionKinds as readonly string[]).includes(record.kind); }
export function isImagePath(path: string) { return /\.(png|jpe?g|webp|gif|avif)$/i.test(path); }
export type AssetDetails = { unresolved: string[]; needs: string[] };
export function assetDetails(record: FilmRecord): AssetDetails { return record.assetDetails ?? { unresolved: [], needs: ['主参考'] }; }
export function assetStatus(record: FilmRecord, available: (m: MediaRef) => boolean = () => true) {
  const { unresolved, needs } = assetDetails(record), images = (record.media ?? []).filter(m => isImagePath(m.path));
  if (unresolved.length) return '待确认信息';
  if (images.some(m => !available(m))) return '参考图需复核';
  if (needs.every(p => images.some(m => m.purpose === p && m.confirmed && available(m)))) return '已绑定参考图';
  return images.length ? '待检查参考图' : '待准备参考图';
}
export const planningFields = ['intent', 'framing', 'camera', 'prompt', 'source', 'start', 'end', 'sound', 'keyframePrompt', 'plannedDuration'] as const;
export const draftFields = ['title', 'body', ...planningFields] as const;
export type Planning = Partial<Record<typeof planningFields[number], string>>;
export function isVideoPath(path: string) { return /\.(mp4|webm|mov|m4v|ogv)$/i.test(path); }
export function shotStatus(shot: FilmRecord) {
  const videos = (shot.media ?? []).filter(m => isVideoPath(m.path));
  if (videos.some(m => m.decision === 'adopted')) return '已采用';
  if (videos.some(m => m.decision !== 'rejected')) return '待选片';
  if (videos.length) return '待重做';
  return shot.body.trim() || shot.intent?.trim() || shot.framing?.trim() ? '待素材' : '待规划';
}
export function orderedShots(scene: FilmRecord | undefined, records: FilmRecord[]) {
  const shots = records.filter(r => r.kind === 'shot' && r.sceneId === scene?.id);
  const ranks = new Map((scene?.shotOrder ?? []).map((id, i) => [id, i]));
  return shots.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) || a.id.localeCompare(b.id));
}
export function validMediaPath(path: string) { return !!path && !/^(?:[a-z]+:|\/)/i.test(path) && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..') && !/[\x00-\x1f]/.test(path); }
export type FilmRecord = Planning & {
  id: string; kind: RecordKind; version: 1; title: string; body: string;
  sceneId?: string; projectId?: string; path: string; media?: MediaRef[]; shotOrder?: string[]; links?: CardLink[]; assetDetails?: AssetDetails;
};
export type Draft = Pick<FilmRecord, 'title' | 'body'> & Planning;
export function draftOf(record: FilmRecord): Draft { return Object.fromEntries(draftFields.map(f => [f, record[f] ?? ''])) as Draft; }
export class RecordError extends Error {}
export class ConflictError extends RecordError {}

function splitNote(source: string) {
  const match = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(source);
  if (!match) {
    if (/^\uFEFF?---\r?\n/.test(source)) throw new RecordError('笔记属性缺少结束分隔符，请先修复原文件。');
    return null;
  }
  const document = parseDocument(match[2]!, { uniqueKeys: true });
  if (document.errors.length) throw new RecordError('笔记属性格式损坏，请先在笔记中修复。');
  const data = document.toJS({ maxAliasCount: 50 }) as unknown;
  return { document, data, header: match[0], body: source.slice(match[0].length), eol: source.includes('\r\n') ? '\r\n' : '\n', bom: source.startsWith('\uFEFF') ? '\uFEFF' : '' };
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function parseRecord(source: string, path: string): FilmRecord | null {
  const note = splitNote(source);
  if (!note || !object(note.data) || !('obcanvas' in note.data)) return null;
  const meta = note.data.obcanvas;
  if (!object(meta) || meta.version !== 1) throw new RecordError('不支持的记录版本，请保留原文件。');
  if (!recordKinds.includes(meta.kind as RecordKind) || typeof meta.id !== 'string' || !meta.id.trim() || typeof meta.title !== 'string' || !meta.title.trim()) throw new RecordError('记录缺少有效的类型、编号或标题。');
  if (meta.projectId !== undefined && (typeof meta.projectId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(meta.projectId))) throw new RecordError('剧本项目编号无效。');
  if (!['scene', 'project'].includes(meta.kind as string) && (typeof meta.sceneId !== 'string' || !meta.sceneId.trim()) && !(meta.projectId && ['person', 'setting', 'prop', 'asset', 'frame'].includes(meta.kind as string))) throw new RecordError('卡片缺少所属场次编号或剧本项目。');
  if (meta.media !== undefined && (!Array.isArray(meta.media) || !meta.media.every(m => object(m) && typeof m.id === 'string' && !!m.id.trim() && typeof m.path === 'string' && validMediaPath(m.path)) || new Set(meta.media.map(m => m.id)).size !== meta.media.length)) throw new RecordError('素材关联格式无效，请保留并检查笔记。');
  if (meta.links !== undefined && (!Array.isArray(meta.links) || !meta.links.every(l => object(l) && typeof l.id === 'string' && !!l.id && typeof l.from === 'string' && /^[rm]:.+/.test(l.from) && linkRoles.includes(l.role as CardLink['role'])) || new Set(meta.links.map(l => l.id)).size !== meta.links.length)) throw new RecordError('卡片关系格式无效，请保留原笔记。');
  for (const m of (meta.media ?? []) as MediaRef[]) {
    if ((m.decision !== undefined && !['candidate', 'adopted', 'rejected'].includes(m.decision)) || (m.reason !== undefined && typeof m.reason !== 'string') || (m.decision && m.decision !== 'candidate' && !isVideoPath(m.path)) || (m.decision === 'rejected' && !m.reason?.trim())) throw new RecordError('素材选片记录无效，请保留并检查笔记。');
    if ((m.purpose !== undefined && (typeof m.purpose !== 'string' || !m.purpose.trim())) || (m.confirmed !== undefined && typeof m.confirmed !== 'boolean') || (m.fingerprint !== undefined && typeof m.fingerprint !== 'string') || (m.confirmed && (!isImagePath(m.path) || !m.purpose || !m.fingerprint))) throw new RecordError('参考图用途或确认记录无效。');
  }
  if (meta.assetDetails !== undefined && (!(productionKinds as readonly unknown[]).includes(meta.kind) || !object(meta.assetDetails) || ![meta.assetDetails.unresolved, meta.assetDetails.needs].every(list => Array.isArray(list) && list.length <= 50 && list.every(s => typeof s === 'string' && !!s.trim() && s.length <= 1000)) || !(meta.assetDetails.needs as unknown[]).length)) throw new RecordError('资产需求格式无效，请保留原笔记。');
  if (((meta.media ?? []) as MediaRef[]).filter(m => m.decision === 'adopted').length > 1) throw new RecordError('一个镜头只能采用一份视频，请检查笔记。');
  if (meta.shotOrder !== undefined && (!Array.isArray(meta.shotOrder) || !meta.shotOrder.every(id => typeof id === 'string' && !!id) || new Set(meta.shotOrder).size !== meta.shotOrder.length)) throw new RecordError('镜头顺序格式无效，请检查场次笔记。');
  for (const field of planningFields) if (meta[field] !== undefined && typeof meta[field] !== 'string') throw new RecordError('镜头规划字段必须是文字。');
  if (meta.plannedDuration !== undefined && meta.plannedDuration !== '' && (!Number.isFinite(Number(meta.plannedDuration)) || Number(meta.plannedDuration) <= 0 || Number(meta.plannedDuration) > 120)) throw new RecordError('计划剪辑时长必须是大于 0 且不超过 120 的秒数。');
  return { id: meta.id, kind: meta.kind as RecordKind, version: 1, title: meta.title, body: note.body, path, ...Object.fromEntries(planningFields.filter(f => meta[f] !== undefined).map(f => [f, meta[f]])), ...(meta.shotOrder ? { shotOrder: meta.shotOrder as string[] } : {}), ...(meta.media ? { media: meta.media as MediaRef[] } : {}), ...(typeof meta.sceneId === 'string' ? { sceneId: meta.sceneId } : {}), ...(typeof meta.projectId === 'string' ? { projectId: meta.projectId } : {}), ...(meta.links ? { links: meta.links as CardLink[] } : {}), ...(meta.assetDetails ? { assetDetails: meta.assetDetails as AssetDetails } : {}) };
}
export function patchMedia(source: string, shotId: string, edit: (items: MediaRef[]) => MediaRef[]) {
  const latest = parseRecord(source, '');
  if (!latest || latest.id !== shotId) throw new ConflictError('镜头身份已变化，请重新载入。');
  const next = edit(latest.media ?? []);
  if (JSON.stringify(next) === JSON.stringify(latest.media ?? [])) return source;
  const note = splitNote(source)!;
  // Preserve unknown per-media fields and comments on existing nodes.
  const previous = note.document.getIn(['obcanvas', 'media'], true);
  const nodes = new Map((latest.media ?? []).map((m, i) => [m.id, isSeq(previous) ? previous.items[i] : undefined]));
  const sequence = note.document.createNode(next as unknown[]);
  if ('items' in sequence) next.forEach((m, i) => {
    const node = nodes.get(m.id);
    if (isMap(node)) {
      node.set('path', m.path);
      for (const field of ['decision', 'reason', 'purpose', 'confirmed', 'fingerprint'] as const) {
        if (m[field] !== undefined) node.set(field, m[field]); else node.delete(field);
      }
      sequence.items[i] = node;
    }
  });
  note.document.setIn(['obcanvas', 'media'], sequence);
  const result = `${note.bom}---${note.eol}${note.document.toString().replace(/\n/g, note.eol)}---${note.eol}${note.body}`;
  parseRecord(result, '');
  return result;
}
export function newRecord(kind: RecordKind, id: string, title: string, sceneId?: string, projectId?: string) {
  return `---\n${stringify({ obcanvas: { version: 1, kind, id, title, ...(!['scene', 'project'].includes(kind) && sceneId ? { sceneId } : {}), ...(projectId ? { projectId } : {}) } })}---\n`;
}
export function sameContent(a: Draft, b: Draft) { return draftFields.every(f => (a[f] ?? '') === (b[f] ?? '')); }
export function patchRecord(source: string, base: FilmRecord, draft: Draft): string {
  if (!draft.title.trim()) throw new RecordError('请填写卡片标题。');
  const latest = parseRecord(source, base.path);
  if (!latest || latest.id !== base.id || latest.kind !== base.kind || latest.sceneId !== base.sceneId || latest.projectId !== base.projectId) throw new ConflictError('记录身份、剧本项目或所属场次已变化，请重新载入笔记。');
  for (const field of draftFields) {
    if ((draft[field] ?? '') !== (base[field] ?? '') && (latest[field] ?? '') !== (base[field] ?? '') && (latest[field] ?? '') !== (draft[field] ?? '')) throw new ConflictError(`${field === 'title' ? '标题' : field === 'body' ? '镜头内容' : '镜头规划字段'}已被其他窗口或笔记修改，本地输入已保留。`);
  }
  const next = { title: draft.title === base.title ? latest.title : draft.title, body: draft.body === base.body ? latest.body : draft.body };
  const note = splitNote(source)!;
  let header = note.header;
  const changedPlan = planningFields.filter(f => (draft[f] ?? '') !== (base[f] ?? ''));
  if (next.title !== latest.title || changedPlan.length) {
    if (!isMap(note.document.contents) || !isMap(note.document.get('obcanvas', true))) throw new RecordError('记录属性格式无效。');
    note.document.setIn(['obcanvas', 'title'], next.title);
    for (const field of changedPlan) note.document.setIn(['obcanvas', field], draft[field] ?? '');
    header = `${note.bom}---${note.eol}${note.document.toString().replace(/\n/g, note.eol)}---${note.eol}`;
  }
  return header + next.body;
}
export type Recovery = { base: FilmRecord; draft: Draft };
export function isRecovery(value: unknown): value is Recovery {
  if (!object(value) || !object(value.base) || !object(value.draft)) return false;
  const b = value.base, d = value.draft;
  return b.version === 1 && recordKinds.includes(b.kind as RecordKind) && (b.kind === 'scene' || b.kind === 'project' || typeof b.sceneId === 'string' || typeof b.projectId === 'string') && ['id', 'title', 'body', 'path'].every(k => typeof b[k] === 'string') && typeof d.title === 'string' && typeof d.body === 'string' && planningFields.every(f => (b[f] === undefined || typeof b[f] === 'string') && (d[f] === undefined || typeof d[f] === 'string'));
}
export function patchOrder(source: string, sceneId: string, edit: (ids: string[]) => string[]) {
  const scene = parseRecord(source, '');
  if (!scene || scene.kind !== 'scene' || scene.id !== sceneId) throw new ConflictError('场次身份已变化，请重新载入。');
  const next = edit(scene.shotOrder ?? []);
  const note = splitNote(source)!;
  note.document.setIn(['obcanvas', 'shotOrder'], next);
  const result = `${note.bom}---${note.eol}${note.document.toString().replace(/\n/g, note.eol)}---${note.eol}${note.body}`;
  parseRecord(result, ''); return result;
}
export function decideMedia(source: string, base: FilmRecord, mediaId: string, decision: NonNullable<MediaRef['decision']>, reason = '') {
  const signature = (items: MediaRef[]) => JSON.stringify(items.filter(m => isVideoPath(m.path)).map(m => [m.id, m.path, m.decision ?? 'candidate', m.reason ?? '']));
  return patchMedia(source, base.id, items => {
    if (signature(items) !== signature(base.media ?? [])) throw new ConflictError('选片记录已被其他窗口修改，请检查最新候选后重试。');
    if (!items.some(m => m.id === mediaId && isVideoPath(m.path))) throw new RecordError('视频候选已移除或变更。');
    if (decision === 'rejected' && !reason.trim()) throw new RecordError('请填写退回原因。');
    return items.map(m => m.id === mediaId ? { ...m, decision, reason: decision === 'rejected' ? reason.trim() : undefined } : decision === 'adopted' && m.decision === 'adopted' ? { ...m, decision: 'candidate', reason: undefined } : m);
  });
}

export function patchLinks(source: string, recordId: string, edit: (links: CardLink[]) => CardLink[]) {
  const record = parseRecord(source, '');
  if (!record || record.id !== recordId) throw new ConflictError('卡片身份已变化，请重新载入。');
  const note = splitNote(source)!;
  note.document.setIn(['obcanvas', 'links'], edit(record.links ?? []));
  const result = `${note.bom}---${note.eol}${note.document.toString().replace(/\n/g, note.eol)}---${note.eol}${note.body}`;
  parseRecord(result, ''); return result;
}

export function patchAssetDetails(source: string, base: FilmRecord, details: AssetDetails) {
  const latest = parseRecord(source, '')!;
  if (!latest || latest.id !== base.id || !isProductionAsset(latest)) throw new ConflictError('资产身份已变化。');
  if (JSON.stringify(assetDetails(latest)) !== JSON.stringify(assetDetails(base))) throw new ConflictError('资产需求已被其他窗口修改，请载入最新内容。');
  const note = splitNote(source)!;
  for (const key of ['unresolved', 'needs'] as const) note.document.setIn(['obcanvas', 'assetDetails', key], details[key]);
  const result = `${note.bom}---${note.eol}${note.document.toString().replace(/\n/g, note.eol)}---${note.eol}${note.body}`;
  parseRecord(result, ''); return result;
}

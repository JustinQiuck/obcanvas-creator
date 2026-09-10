import { isMap, isSeq, parseDocument, stringify } from 'yaml';

export type RecordKind = 'scene' | 'shot';
export type MediaRef = { id: string; path: string };
export function validMediaPath(path: string) { return !!path && !/^(?:[a-z]+:|\/)/i.test(path) && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..') && !/[\x00-\x1f]/.test(path); }
export type FilmRecord = {
  id: string; kind: RecordKind; version: 1; title: string; body: string;
  sceneId?: string; path: string; media?: MediaRef[];
};
export type Draft = Pick<FilmRecord, 'title' | 'body'>;
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
  if ((meta.kind !== 'scene' && meta.kind !== 'shot') || typeof meta.id !== 'string' || !meta.id.trim() || typeof meta.title !== 'string' || !meta.title.trim()) throw new RecordError('记录缺少有效的类型、编号或标题。');
  if (meta.kind === 'shot' && (typeof meta.sceneId !== 'string' || !meta.sceneId.trim())) throw new RecordError('镜头缺少所属场次编号。');
  if (meta.media !== undefined && (!Array.isArray(meta.media) || !meta.media.every(m => object(m) && typeof m.id === 'string' && !!m.id.trim() && typeof m.path === 'string' && validMediaPath(m.path)) || new Set(meta.media.map(m => m.id)).size !== meta.media.length)) throw new RecordError('素材关联格式无效，请保留并检查笔记。');
  return { id: meta.id, kind: meta.kind, version: 1, title: meta.title, body: note.body, path, ...(meta.media ? { media: meta.media as MediaRef[] } : {}), ...(meta.kind === 'shot' ? { sceneId: meta.sceneId as string } : {}) };
}
export function patchMedia(source: string, shotId: string, edit: (items: MediaRef[]) => MediaRef[]) {
  const latest = parseRecord(source, '');
  if (!latest || latest.kind !== 'shot' || latest.id !== shotId) throw new ConflictError('镜头身份已变化，请重新载入。');
  const next = edit(latest.media ?? []);
  if (JSON.stringify(next) === JSON.stringify(latest.media ?? [])) return source;
  const note = splitNote(source)!;
  // Preserve unknown per-media fields and comments on existing nodes.
  const previous = note.document.getIn(['obcanvas', 'media'], true);
  const nodes = new Map((latest.media ?? []).map((m, i) => [m.id, isSeq(previous) ? previous.items[i] : undefined]));
  const sequence = note.document.createNode(next as unknown[]);
  if ('items' in sequence) next.forEach((m, i) => {
    const node = nodes.get(m.id);
    if (isMap(node)) { node.set('path', m.path); sequence.items[i] = node; }
  });
  note.document.setIn(['obcanvas', 'media'], sequence);
  const result = `${note.bom}---${note.eol}${note.document.toString().replace(/\n/g, note.eol)}---${note.eol}${note.body}`;
  parseRecord(result, '');
  return result;
}
export function newRecord(kind: RecordKind, id: string, title: string, sceneId?: string) {
  return `---\n${stringify({ obcanvas: { version: 1, kind, id, title, ...(kind === 'shot' ? { sceneId } : {}) } })}---\n`;
}
export function sameContent(a: Draft, b: Draft) { return a.title === b.title && a.body === b.body; }
export function patchRecord(source: string, base: FilmRecord, draft: Draft): string {
  if (!draft.title.trim()) throw new RecordError('请填写镜头标题。');
  const latest = parseRecord(source, base.path);
  if (!latest || latest.id !== base.id || latest.kind !== base.kind || latest.sceneId !== base.sceneId) throw new ConflictError('记录身份或所属场次已变化，请重新载入笔记。');
  for (const field of ['title', 'body'] as const) {
    if (draft[field] !== base[field] && latest[field] !== base[field] && latest[field] !== draft[field]) throw new ConflictError(`${field === 'title' ? '标题' : '镜头内容'}已被其他窗口或笔记修改，本地输入已保留。`);
  }
  const next = { title: draft.title === base.title ? latest.title : draft.title, body: draft.body === base.body ? latest.body : draft.body };
  const note = splitNote(source)!;
  let header = note.header;
  if (next.title !== latest.title) {
    if (!isMap(note.document.contents) || !isMap(note.document.get('obcanvas', true))) throw new RecordError('记录属性格式无效。');
    note.document.setIn(['obcanvas', 'title'], next.title);
    header = `${note.bom}---${note.eol}${note.document.toString().replace(/\n/g, note.eol)}---${note.eol}`;
  }
  return header + next.body;
}
export type Recovery = { base: FilmRecord; draft: Draft };
export function isRecovery(value: unknown): value is Recovery {
  if (!object(value) || !object(value.base) || !object(value.draft)) return false;
  const b = value.base, d = value.draft;
  return b.version === 1 && b.kind === 'shot' && ['id', 'title', 'body', 'path', 'sceneId'].every(k => typeof b[k] === 'string') && typeof d.title === 'string' && typeof d.body === 'string';
}

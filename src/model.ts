import { isMap, parseDocument, stringify } from 'yaml';

export type RecordKind = 'scene' | 'shot';
export type FilmRecord = {
  id: string; kind: RecordKind; version: 1; title: string; body: string;
  sceneId?: string; path: string;
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
  return { id: meta.id, kind: meta.kind, version: 1, title: meta.title, body: note.body, path, ...(meta.kind === 'shot' ? { sceneId: meta.sceneId as string } : {}) };
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

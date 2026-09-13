import { orderedShots, projectOf, type FilmRecord } from './model';

export type ProjectOrderDraft = { project: FilmRecord; scope: string; ids: string[] };
export function projectOrderView(project: FilmRecord, records: FilmRecord[]) {
  const shots = records.filter(r => r.kind === 'shot' && projectOf(r, records) === project.id);
  const byId = new Map(shots.map(r => [r.id, r]));
  return {
    ordered: (project.editOrder ?? []).flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
    pending: shots.filter(r => !project.editOrder?.includes(r.id)),
    missing: (project.editOrder ?? []).filter(id => !byId.has(id)),
  };
}
export function projectOrderScope(project: FilmRecord, records: FilmRecord[]) {
  // Content, titles, media and layout can change without invalidating an order draft.
  return JSON.stringify({ order: project.editOrder ?? null, members: records.filter(r => ['shot', 'scene'].includes(r.kind) && projectOf(r, records) === project.id).map(r => [r.id, r.kind, r.sceneId ?? '', project.editOrder === undefined && r.kind === 'scene' ? r.shotOrder ?? [] : null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) });
}
export function initialProjectOrder(project: FilmRecord, records: FilmRecord[]) {
  if (project.editOrder !== undefined) return [...project.editOrder];
  // This is a visible proposal only; no inferred cross-scene order is persisted on read.
  return records.filter(r => r.kind === 'scene' && projectOf(r, records) === project.id).flatMap(scene => orderedShots(scene, records).filter(r => projectOf(r, records) === project.id).map(r => r.id));
}
export function moveVisibleOrder(ids: string[], visible: Set<string>, id: string, direction: -1 | 1) {
  const slots = ids.map((value, index) => visible.has(value) ? index : -1).filter(index => index >= 0);
  const position = slots.findIndex(index => ids[index] === id), other = position + direction;
  if (position < 0 || other < 0 || other >= slots.length) return ids;
  const next = [...ids], a = slots[position]!, b = slots[other]!;
  [next[a], next[b]] = [next[b]!, next[a]!]; return next;
}

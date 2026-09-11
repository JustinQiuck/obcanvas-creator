import { kindLabels, isVideoPath, type FilmRecord, type MediaRef, type CardLink } from '../model';

export type BoardNode = { id: string; positionId: string; title: string; label: string; body: string; record?: FilmRecord; reference?: MediaRef };
export type BoardEdge = { id: string; from: string; to: string; label: string; target: FilmRecord; link?: CardLink; media?: MediaRef };
// Media decisions belong to the target record. Nodes never copy adoption state.
export function buildGraph(records: FilmRecord[], sceneId: string) {
  const cards = records.filter(r => r.sceneId === sceneId && r.kind !== 'scene');
  const nodes: BoardNode[] = cards.map(r => ({ id: `r:${r.id}`, positionId: r.id, title: r.title, label: kindLabels[r.kind], body: r.body, record: r, reference: r.kind !== 'shot' ? r.media?.[0] : undefined }));
  const owners = new Map<string, string>();
  nodes.forEach(n => { if (n.reference && !owners.has(n.reference.id)) owners.set(n.reference.id, n.id); });
  const edges: BoardEdge[] = [];
  for (const r of cards) {
    for (const ref of r.media ?? []) {
      let from = owners.get(ref.id);
      if (!from) {
        from = `m:${ref.id}`; owners.set(ref.id, from);
        nodes.push({ id: from, positionId: from, title: ref.path.split('/').pop()!, label: isVideoPath(ref.path) ? '视频' : '图片', body: '', reference: ref });
      }
      if (from !== `r:${r.id}`) edges.push({ id: `media:${r.id}:${ref.id}`, from, to: `r:${r.id}`, label: r.kind === 'shot' ? isVideoPath(ref.path) ? '视频候选' : '参考图' : '素材', target: r, media: ref });
    }
    for (const link of r.links ?? []) edges.push({ id: `link:${r.id}:${link.id}`, from: link.from, to: `r:${r.id}`, label: link.role, target: r, link });
  }
  // m: identities remain resolvable after a media card receives a record owner.
  for (const edge of edges) if (edge.from.startsWith('m:')) edge.from = owners.get(edge.from.slice(2)) ?? edge.from;
  return { nodes, edges };
}

import { useRef, useState } from 'react';
import { shotStatus } from '../model';
import type { BoardNode } from './graph';
import type { Position } from './types';
import type { VaultMedia } from '../storage/vault-media';

export function BoardCard({ node, media, position, scale, selected, onSelect, onMove, onConnect }: { node: BoardNode; media: VaultMedia; position: Position; scale: number; selected: boolean; onSelect: () => void; onMove: (p: Position) => void; onConnect: () => void }) {
  const drag = useRef<{ id: number; x: number; y: number; start: Position; moved: boolean } | null>(null);
  const moved = useRef(false);
  const [failed, setFailed] = useState(false);
  const source = node.reference ? media.locate(node.reference) : undefined;
  return <div className={`obcanvas-node obcanvas-board-node ${selected ? 'is-selected' : ''}`} data-node-id={node.id} role="button" tabIndex={0} aria-label={`${node.label}卡：${node.title}`} aria-pressed={selected}
    style={{ left: position.x, top: position.y }} onClick={() => { if (!moved.current) onSelect(); moved.current = false; }}
    onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    onPointerDown={e => { if (e.button !== 0 || (e.target as Element).closest('button')) return; e.stopPropagation(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); moved.current = false; drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: position, moved: false }; }}
    onPointerMove={e => { const d = drag.current; if (d?.id !== e.pointerId) return; if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = moved.current = true; if (d.moved) onMove({ x: d.start.x + (e.clientX - d.x) / scale, y: d.start.y + (e.clientY - d.y) / scale }); }}
    onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
    <span className="obcanvas-node-kicker">{node.label}</span><strong>{node.title}</strong>
    {source?.kind === 'image' && !failed && <img className="obcanvas-node-image" src={source.url} alt={node.title} draggable={false} onError={() => setFailed(true)} />}
    {source?.kind === 'video' && <span className="obcanvas-node-video">▷ <small>视频素材 · 点击播放</small></span>}
    {(source?.error || failed) && <span className="obcanvas-missing">素材缺失或无法读取</span>}
    <span className="obcanvas-node-body">{node.body || (node.record?.kind === 'script' ? '点击粘贴剧本，从故事开始整理。' : '点击编辑，连接到需要它的镜头。')}</span>
    <span className="obcanvas-node-state">{node.record?.kind === 'shot' ? shotStatus(node.record) : '点击编辑 · 拖动整理'}</span>
    <button className="obcanvas-port" aria-label={`从${node.title}连接`} title="连接到另一张卡" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onConnect(); }}>＋</button>
  </div>;
}

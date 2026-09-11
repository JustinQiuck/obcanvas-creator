import { useRef } from 'react';
import { shotStatus, type FilmRecord } from '../model';
import type { Position } from './types';
export function ShotCard({ shot, number, missing, position, scale, selected, disabled, onSelect, onMove }: { shot: FilmRecord; number: number; missing: boolean; position: Position; scale: number; selected: boolean; disabled: boolean; onSelect: () => void; onMove: (p: Position) => void }) {
  const drag = useRef<{ id: number; x: number; y: number; start: Position } | null>(null);
  return <button className={`obcanvas-node ${selected ? 'is-selected' : ''}`} data-node-id={shot.id} aria-label={`镜头卡：${shot.title}`} aria-pressed={selected} disabled={disabled}
    style={{ left: position.x, top: position.y }} onClick={onSelect}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.stopPropagation(); onSelect(); e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: position };
    }}
    onPointerMove={e => { const d = drag.current; if (d?.id === e.pointerId) onMove({ x: d.start.x + (e.clientX - d.x) / scale, y: d.start.y + (e.clientY - d.y) / scale }); }}
    onPointerUp={e => { if (drag.current?.id === e.pointerId) { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); } }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
    <span className="obcanvas-node-kicker">{String(number).padStart(2, '0')} · {shotStatus(shot)}{missing ? ' · 素材缺失' : ''}</span><strong>{shot.title}</strong>
    <span className="obcanvas-node-body">{shot.body || '尚未填写镜头内容'}</span>
    <span className="obcanvas-node-kicker">{shot.media?.length ? `已关联 ${shot.media.length} 份素材` : '尚未关联素材'}</span>
  </button>;
}

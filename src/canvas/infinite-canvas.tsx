// Adapted from infinite-canvas. Copyright (c) 2026 basketikun, MIT.
// Source snapshot: docs/source-reuse.md; license: licenses/infinite-canvas-MIT.txt.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canvasThemes, type CanvasColorTheme } from './theme';
import type { ViewportTransform } from './types';

type Props = { viewport: ViewportTransform; onViewportChange: (v: ViewportTransform) => void; children: ReactNode; onFit?: () => void; onBlankClick?: () => void };
export function InfiniteCanvas({ viewport, onViewportChange, children, onFit, onBlankClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ viewport, onViewportChange });
  latest.current = { viewport, onViewportChange };
  const pan = useRef<{ moved?: boolean; id: number; startX: number; startY: number; initial: ViewportTransform } | null>(null);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [color, setColor] = useState<CanvasColorTheme>('dark');
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const win = container.ownerDocument.defaultView!;
    const body = container.ownerDocument.body;
    const sync = () => setColor(body.classList.contains('theme-dark') ? 'dark' : 'light');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    const blur = () => { pan.current = null; setPanning(false); setSpace(false); };
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('[data-canvas-no-zoom]')) return;
      event.preventDefault();
      const { viewport: v, onViewportChange: change } = latest.current;
      const k = Math.min(Math.max(v.k * Math.pow(1.1, -event.deltaY / 100), .05), 5);
      const rect = container.getBoundingClientRect();
      const mx = event.clientX - rect.left, my = event.clientY - rect.top;
      change({ x: mx - (mx - v.x) / v.k * k, y: my - (my - v.y) / v.k * k, k });
    };
    container.addEventListener('wheel', wheel, { passive: false });
    win.addEventListener('blur', blur);
    return () => { observer.disconnect(); container.removeEventListener('wheel', wheel); win.removeEventListener('blur', blur); pan.current = null; };
  }, []);
  const theme = canvasThemes[color];
  const gridSize = 48 * viewport.k;
  const isPan = tool === 'pan' || space;
  return <div ref={containerRef} tabIndex={0} role="region" aria-label="镜头画布" className="obcanvas-surface" data-pan-mode={isPan} data-theme={color}
    style={{ background: theme.canvas.background, color: theme.node.text, cursor: panning ? 'grabbing' : isPan ? 'grab' : undefined, '--obcanvas-node-panel': theme.node.panel, '--obcanvas-node-border': theme.node.stroke, '--obcanvas-node-active': theme.node.activeStroke } as React.CSSProperties}
    onKeyDown={e => { if (e.target === e.currentTarget && e.code === 'Space') { e.preventDefault(); e.stopPropagation(); setSpace(true); } }}
    onKeyUp={e => { if (e.code === 'Space') setSpace(false); }} onBlur={() => { setSpace(false); }}
    onPointerDownCapture={e => {
      const target = e.target as Element;
      if (target.closest('[data-canvas-no-zoom]')) return;
      if (e.button === 1 || (e.button === 0 && (isPan || !target.closest('[data-node-id]')))) {
        e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
        pan.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, initial: viewport }; setPanning(true);
      } else if (!target.closest('[data-node-id]')) e.currentTarget.focus();
    }}
    onPointerMove={e => { const p = pan.current; if (p?.id === e.pointerId) { if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 4) p.moved = true; onViewportChange({ ...p.initial, x: p.initial.x + e.clientX - p.startX, y: p.initial.y + e.clientY - p.startY }); } }}
    onPointerUp={e => { if (pan.current?.id === e.pointerId) { if (!pan.current.moved) onBlankClick?.(); pan.current = null; setPanning(false); e.currentTarget.releasePointerCapture(e.pointerId); } }}
    onPointerCancel={() => { pan.current = null; setPanning(false); }} onLostPointerCapture={() => { pan.current = null; setPanning(false); }}>
    <div className="obcanvas-grid" style={{ backgroundImage: `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`, backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${viewport.x % gridSize}px ${viewport.y % gridSize}px` }} />
    <div className="obcanvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}>{children}</div>
    <div className="obcanvas-canvas-tools" data-canvas-no-zoom>
      <button aria-pressed={tool === 'select'} onClick={() => setTool('select')}>选择</button>
      <button aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}>平移</button>
      {onFit && <button onClick={onFit}>总览</button>}
      <button onClick={() => onViewportChange({ x: 32, y: 32, k: 1 })}>重置视口</button>
      <span>{Math.round(viewport.k * 100)}%</span>
    </div>
  </div>;
}

import type { ViewportTransform } from './types';
// Per-view focus/zoom lives in Obsidian workspace state; scene layout is the default for a new view.
export class Viewports {
  private value: Record<string, ViewportTransform> = {};
  private listeners = new Set<() => void>();
  constructor(private changed: () => void) {}
  getSnapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  update(sceneId: string, viewport: ViewportTransform) {
    this.value = { ...this.value, [sceneId]: viewport }; this.listeners.forEach(fn => fn()); this.changed();
  }
  restore(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const values = Object.entries(input).filter(([, v]) => v && ['x', 'y', 'k'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k])) && v.k >= .05 && v.k <= 5);
    this.value = Object.fromEntries(values); this.listeners.forEach(fn => fn());
  }
}

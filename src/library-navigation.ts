export const librarySections = { scripts: '剧本', assets: '资产库', storyboard: '分镜', media: '生成素材', canvas: '画布' } as const;
export type LibrarySection = keyof typeof librarySections;
export type LibraryLocation = { projectId: string; section: LibrarySection; scriptId: string };
export class LibraryNavigation {
  private value: LibraryLocation = { projectId: '', section: 'scripts', scriptId: '' };
  private listeners = new Set<() => void>();
  constructor(private changed: () => void) {}
  getSnapshot = () => this.value;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  update(patch: Partial<LibraryLocation>) { this.value = { ...this.value, ...patch }; this.listeners.forEach(fn => fn()); this.changed(); }
  restore(input: unknown) {
    if (!input || typeof input !== 'object') return;
    const value = input as LibraryLocation;
    if (typeof value.projectId === 'string' && typeof value.scriptId === 'string' && Object.hasOwn(librarySections, value.section)) this.update(value);
  }
}

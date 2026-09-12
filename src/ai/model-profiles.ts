import { chatEndpoint, readAISettings, type AISettings } from './chat-client';

export type ModelProfile = AISettings & { id: string; name: string };
export type ModelConfig = { profiles: ModelProfile[]; selectedId: string };
export const legacyProfileId = 'legacy';
export function readModelConfig(value: unknown, legacy?: unknown): ModelConfig {
  if (value === undefined) {
    const settings = readAISettings(legacy);
    return settings.baseUrl || settings.model ? { profiles: [{ ...settings, id: legacyProfileId, name: '原有模型配置' }], selectedId: legacyProfileId } : { profiles: [], selectedId: '' };
  }
  if (!value || typeof value !== 'object') throw new Error('模型配置格式无效，原配置已保留。');
  const config = value as ModelConfig;
  if (!Array.isArray(config.profiles) || typeof config.selectedId !== 'string') throw new Error('模型配置格式无效，原配置已保留。');
  const profiles = config.profiles.map(p => {
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100) throw new Error('模型配置名称或编号无效。');
    return { ...readAISettings(p), id: p.id, name: p.name };
  });
  if (new Set(profiles.map(p => p.id)).size !== profiles.length || (profiles.length ? !profiles.some(p => p.id === config.selectedId) : config.selectedId !== '')) throw new Error('模型配置重复或所选模型不存在。');
  return { profiles, selectedId: config.selectedId };
}
export class ModelProfiles {
  private listeners = new Set<() => void>();
  private writing = false;
  constructor(private snapshot: ModelConfig, private persist: (next: ModelConfig) => Promise<void>) {}
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  selected() { return this.snapshot.profiles.find(p => p.id === this.snapshot.selectedId); }
  async save(profile: ModelProfile) {
    chatEndpoint(profile.baseUrl);
    if (!profile.model.trim() || profile.model.length > 250) throw new Error('请填写 250 字以内的模型名称。');
    const next = { ...profile, name: profile.name.trim(), model: profile.model.trim(), baseUrl: profile.baseUrl.trim() };
    const profiles = this.snapshot.profiles.some(p => p.id === next.id) ? this.snapshot.profiles.map(p => p.id === next.id ? next : p) : [...this.snapshot.profiles, next];
    await this.commit({ profiles, selectedId: this.snapshot.selectedId || next.id });
  }
  async select(id: string) { await this.commit({ ...this.snapshot, selectedId: id }); }
  private async commit(next: ModelConfig) {
    if (this.writing) throw new Error('模型配置正在保存，请稍后重试。');
    const validated = readModelConfig(next); this.writing = true;
    try { await this.persist(validated); this.snapshot = validated; this.listeners.forEach(fn => fn()); }
    finally { this.writing = false; }
  }
}

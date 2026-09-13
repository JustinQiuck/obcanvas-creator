import type { TFile, Vault } from 'obsidian';
import type { StoryboardSkill } from '../ai/storyboard-skill';

export const STORYBOARD_SETTINGS_PATH = '影视项目/分镜方法配置.json';
export type StoryboardDirection = { skillId: string; format: 'drama' | 'mv'; direction: string; musicTiming: string };
type Settings = { version: 1; custom: StoryboardSkill[]; projects: Record<string, StoryboardDirection>; scripts: Record<string, StoryboardDirection> };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
export function parseStoryboardSettings(raw: string): Settings {
  const v: unknown = JSON.parse(raw);
  const choices = (value: unknown) => object(value) && Object.keys(value).length <= 10000 && Object.entries(value).every(([id, c]) => /^[a-zA-Z0-9-]{1,80}$/.test(id) && object(c) && typeof c.skillId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(c.skillId) && ['drama', 'mv'].includes(String(c.format)) && text(c.direction, 4000) && text(c.musicTiming, 4000));
  if (!object(v) || v.version !== 1 || !choices(v.projects) || !choices(v.scripts) || !Array.isArray(v.custom) || v.custom.length > 100 || !v.custom.every(s => object(s) && typeof s.id === 'string' && /^custom-[a-zA-Z0-9-]{1,73}$/.test(s.id) && s.stage === 'storyboard' && typeof s.name === 'string' && !!s.name.trim() && s.name.length <= 100 && typeof s.version === 'string' && !!s.version && s.version.length <= 100 && typeof s.instructions === 'string' && !!s.instructions.trim() && s.instructions.length <= 20000) || new Set(v.custom.map(s => s.id)).size !== v.custom.length) throw new Error('分镜方法配置损坏，已保留原文件，请修复后重新读取。');
  return v as Settings;
}
export class VaultStoryboardSettings {
  private state: { config: Settings; loading: boolean; busy: boolean; error: string } = { config: this.defaults(), loading: true, busy: false, error: '' };
  private listeners = new Set<() => void>();
  private revision = 0;
  private disposed = false;
  private seenFile = false;
  constructor(private vault: Vault, readonly builtin: StoryboardSkill) {}
  private defaults(): Settings { return { version: 1, custom: [], projects: {}, scripts: {} }; }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(patch: Partial<typeof this.state>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  skills() { return [this.builtin, ...this.state.config.custom]; }
  choice(scriptId: string, projectId: string): StoryboardDirection { return structuredClone(this.state.config.scripts[scriptId] ?? this.state.config.projects[projectId] ?? { skillId: this.builtin.id, format: 'drama', direction: '', musicTiming: '' }); }
  resolve(scriptId: string, projectId: string) {
    if (this.state.loading || this.state.busy || this.state.error) throw new Error(this.state.error || '分镜方法正在读取或保存。');
    const choice = this.choice(scriptId, projectId), skill = this.skills().find(s => s.id === choice.skillId);
    if (!skill) throw new Error('所选分镜 Skill 已不存在，请重新选择；未自动替换。');
    if (choice.format === 'mv' && (skill.id === this.builtin.id || !choice.musicTiming.trim())) throw new Error('音乐 MV 需要选择适用的自定义分镜方法，并填写已确认的音乐段落或时间点；不自动套用短剧规则。');
    return { choice, skill: structuredClone(skill) };
  }
  async refresh() {
    if (this.state.busy || this.disposed) return;
    const revision = ++this.revision;
    try {
      const file = this.vault.getAbstractFileByPath(STORYBOARD_SETTINGS_PATH);
      if (file && !('extension' in file)) throw new Error('分镜方法配置路径被文件夹占用。');
      if (!file && this.seenFile) throw new Error('分镜方法配置已移除，请恢复；未自动重建。');
      const config = file ? parseStoryboardSettings(await this.vault.read(file as TFile)) : this.defaults();
      if (revision !== this.revision) return;
      this.seenFile ||= !!file; this.emit({ config, loading: false, error: '' });
    } catch (error) { if (revision === this.revision) this.emit({ loading: false, error: (error as Error).message }); }
  }
  async saveChoice(scriptId: string, projectId: string, choice: StoryboardDirection, asDefault = false, followDefault = false) {
    if (!followDefault && !this.skills().some(s => s.id === choice.skillId)) throw new Error('请选择存在的分镜 Skill。');
    await this.save(config => {
      if (asDefault) config.projects[projectId] = choice;
      else if (followDefault) delete config.scripts[scriptId];
      else config.scripts[scriptId] = choice;
    });
  }
  async saveCustom(name: string, instructions: string, base?: StoryboardSkill) {
    const next: StoryboardSkill = { id: base?.id ?? `custom-${crypto.randomUUID()}`, name: name.trim(), stage: 'storyboard', instructions: instructions.trim(), version: crypto.randomUUID() };
    await this.save(config => {
      if (base) {
        const prior = config.custom.find(s => s.id === base.id);
        if (!prior || JSON.stringify(prior) !== JSON.stringify(base)) throw new Error('规则已被更新或是内置方法；请重新读取或复制为自定义。');
        config.custom = config.custom.map(s => s.id === base.id ? next : s);
      } else config.custom.push(next);
    });
    return next;
  }
  private async save(edit: (config: Settings) => void) {
    if (this.state.busy || this.state.loading || this.state.error) throw new Error(this.state.error || '请等待分镜配置就绪。');
    const base = structuredClone(this.state.config), draft = structuredClone(base); edit(draft);
    const next = parseStoryboardSettings(JSON.stringify(draft)); this.revision++; this.emit({ busy: true });
    try {
      const file = this.vault.getAbstractFileByPath(STORYBOARD_SETTINGS_PATH), raw = JSON.stringify(next, null, 2) + '\n';
      if (file && !('extension' in file)) throw new Error('分镜方法路径被占用。');
      if (file) await this.vault.process(file as TFile, source => { if (JSON.stringify(parseStoryboardSettings(source)) !== JSON.stringify(base)) throw new Error('分镜方法已被其他窗口修改，请重新读取；本地输入保留。'); return raw; });
      else {
        if (this.seenFile) throw new Error('分镜方法文件已移除，未重建。');
        if (!this.vault.getAbstractFileByPath('影视项目')) await this.vault.createFolder('影视项目');
        await this.vault.create(STORYBOARD_SETTINGS_PATH, raw);
      }
      this.seenFile = true; this.emit({ config: next, error: '' });
    } catch (error) { this.emit({ error: (error as Error).message }); throw error; }
    finally { this.emit({ busy: false }); }
  }
  dispose() { this.disposed = true; this.revision++; this.listeners.clear(); }
}

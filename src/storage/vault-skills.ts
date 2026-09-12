import type { TFile, Vault } from 'obsidian';
import { parseSkillConfig, type AssetSkill, type SkillConfig } from '../ai/skill-model';
import { PROJECT_ROOT, errorMessage } from './vault-records';

export const SKILLS_PATH = `${PROJECT_ROOT}/技能配置.json`;
type Access = Pick<Vault, 'getAbstractFileByPath' | 'read' | 'process' | 'create' | 'createFolder'>;
export class VaultSkills {
  private snapshot: { config: SkillConfig; skills: AssetSkill[]; busy: boolean; loading: boolean; error: string };
  private listeners = new Set<() => void>();
  private revision = 0; private disposed = false;
  constructor(private vault: Access, private builtins: AssetSkill[]) {
    this.snapshot = { config: this.defaults(), skills: [...builtins], busy: false, loading: true, error: '' };
  }
  private defaults(): SkillConfig { return { version: 1, defaultAssetSkillId: this.builtins[0]!.id, scripts: {}, custom: [] }; }
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(patch: Partial<typeof this.snapshot>) { if (this.disposed) return; this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  private file() {
    const file = this.vault.getAbstractFileByPath(SKILLS_PATH);
    if (file && !('extension' in file)) throw new Error('Skill 配置路径被文件夹占用。');
    return file as TFile | null;
  }
  async refresh() {
    if (this.snapshot.busy || this.disposed) return;
    const revision = ++this.revision;
    try {
      const file = this.file();
      if (!file && JSON.stringify(this.snapshot.config) !== JSON.stringify(this.defaults())) throw new Error('Skill 配置文件已移除，请恢复文件后重新读取；没有自动替换规则。');
      const config = file ? parseSkillConfig(await this.vault.read(file)) : this.defaults();
      if (revision !== this.revision) return;
      this.emit({ config, skills: [...this.builtins, ...config.custom], loading: false, error: '' });
    } catch (e) { if (revision === this.revision) this.emit({ loading: false, error: errorMessage(e) }); }
  }
  choice(scriptId?: string, projectId?: string) {
    const { config } = this.snapshot;
    return scriptId && Object.hasOwn(config.scripts, scriptId) ? config.scripts[scriptId]! : projectId && config.projects && Object.hasOwn(config.projects, projectId) ? config.projects[projectId]! : config.defaultAssetSkillId;
  }
  resolve(scriptId?: string, projectId?: string) {
    if (this.snapshot.loading || this.snapshot.busy || this.snapshot.error) throw new Error(this.snapshot.error || 'Skill 配置正在读取或保存，请稍后重试。');
    const skill = this.snapshot.skills.find(s => s.id === this.choice(scriptId, projectId));
    if (!skill) throw new Error('所选 Skill 已不存在，请重新选择；没有自动替换为其他规则。');
    return structuredClone(skill);
  }
  private async save(change: (base: SkillConfig) => SkillConfig) {
    if (this.snapshot.busy || this.snapshot.loading || this.snapshot.error) throw new Error(this.snapshot.error || '请等待 Skill 配置就绪。');
    const base = structuredClone(this.snapshot.config), next = parseSkillConfig(JSON.stringify(change(structuredClone(base))));
    this.revision++; this.emit({ busy: true });
    try {
      const raw = JSON.stringify(next, null, 2) + '\n';
      const file = this.file();
      if (file) await this.vault.process(file, current => {
        if (JSON.stringify(parseSkillConfig(current)) !== JSON.stringify(base)) throw new Error('Skill 配置已被其他窗口修改，请重新读取后再保存；当前编辑仍保留。');
        return raw;
      });
      else {
        if (JSON.stringify(base) !== JSON.stringify(this.defaults())) throw new Error('Skill 配置文件已移除，请重新读取，未自动重建。');
        if (!this.vault.getAbstractFileByPath(PROJECT_ROOT)) {
          try { await this.vault.createFolder(PROJECT_ROOT); } catch (e) { if (!this.vault.getAbstractFileByPath(PROJECT_ROOT)) throw e; }
        }
        await this.vault.create(SKILLS_PATH, raw);
      }
      this.emit({ config: next, skills: [...this.builtins, ...next.custom], error: '' });
    } catch (e) { this.emit({ error: errorMessage(e) }); throw e; }
    finally { this.emit({ busy: false }); }
  }
  async choose(id: string, scriptId?: string, projectId?: string) {
    if (id && !this.snapshot.skills.some(s => s.id === id)) throw new Error('Skill 不存在，请重新选择。');
    if (!id && !scriptId) throw new Error('请选择项目默认 Skill。');
    await this.save(config => {
      if (scriptId) {
        if (id) Object.defineProperty(config.scripts, scriptId, { value: id, enumerable: true, writable: true, configurable: true });
        else delete config.scripts[scriptId];
      } else if (projectId) config.projects = { ...config.projects, [projectId]: id };
      else config.defaultAssetSkillId = id;
      return config;
    });
  }
  async saveCustom(name: string, instructions: string, base?: AssetSkill) {
    const next: AssetSkill = { id: base?.id ?? `custom-${crypto.randomUUID()}`, name: name.trim(), instructions: instructions.trim(), stage: 'assets', version: crypto.randomUUID() };
    await this.save(config => {
      if (base) {
        const current = config.custom.find(s => s.id === base.id);
        if (!current || JSON.stringify(current) !== JSON.stringify(base)) throw new Error('此 Skill 已更新或为内置规则，请重新打开编辑；内置规则可复制后修改。');
        config.custom = config.custom.map(s => s.id === base.id ? next : s);
      } else config.custom.push(next);
      return config;
    });
    return next;
  }
  dispose() { this.disposed = true; this.revision++; this.listeners.clear(); }
}

import { PluginSettingTab, Setting, type App } from 'obsidian';
import type ObCanvasPlugin from '../main';
import type { ModelProfile } from '../ai/model-profiles';
export class AISettingsTab extends PluginSettingTab {
  private controller?: AbortController;
  private editingId = '';
  constructor(app: App, private plugin: ObCanvasPlugin) { super(app, plugin); }
  hide() { this.controller?.abort(); }
  display() {
    this.controller?.abort();
    const el = this.containerEl; el.empty();
    el.createEl('h2', { text: 'AI 助手 · 模型配置' });
    el.createEl('p', { text: '可保存多组 Chat Completions 兼容文字模型。在项目顶部选择本次使用的模型；图片和视频仍在外部生成。切换配置前请先保存正在编辑的内容。' });
    const config = this.plugin.models.getSnapshot();
    const existing = config.profiles.find(p => p.id === (this.editingId || config.selectedId));
    const draft: ModelProfile = existing ? { ...existing } : { id: crypto.randomUUID(), name: '', baseUrl: '', model: '' };
    let key: string | undefined, busy = false;
    new Setting(el).setName('编辑模型配置').addDropdown(d => {
      d.addOption('new', '＋ 新增模型配置'); for (const profile of config.profiles) d.addOption(profile.id, profile.name);
      d.setValue(existing?.id ?? 'new').onChange(id => { if (busy) { d.setValue(existing?.id ?? 'new'); return; } this.editingId = id; this.display(); });
    });
    new Setting(el).setName('配置名称').setDesc('用于前端选择，例如“日常整理”或“分镜精修”。').addText(t => t.setValue(draft.name).onChange(v => { draft.name = v; }));
    new Setting(el).setName('服务地址').setDesc('填写版本路径，如 https://服务域名/v1，也支持完整 /chat/completions 地址。').addText(t => t.setPlaceholder('https://服务域名/v1').setValue(draft.baseUrl).onChange(v => { draft.baseUrl = v; }));
    new Setting(el).setName('模型名称').setDesc('填写服务商提供的模型标识。').addText(t => t.setValue(draft.model).onChange(v => { draft.model = v; }));
    new Setting(el).setName('API 密钥').setDesc(this.plugin.app.secretStorage ? '每组配置独立使用 Obsidian 密钥存储；不编辑此栏会保留已有密钥。' : '每组密钥仅在本次会话保存，重开后需要重新填写。').addText(t => { t.inputEl.type = 'password'; t.setPlaceholder(this.plugin.getAISecret(draft.id) ? '已保存；输入可替换' : '无需密钥的服务可留空').onChange(v => { key = v; }); });
    const status = el.createEl('p', { attr: { role: 'status' } });
    const save = async () => { await this.plugin.saveModelProfile({ ...draft }, key); key = undefined; this.editingId = draft.id; };
    new Setting(el).addButton(b => b.setButtonText('保存配置').setCta().onClick(async () => {
      if (busy) return; busy = true; b.setDisabled(true);
      try { await save(); this.display(); this.containerEl.createEl('p', { text: '配置已保存，可在项目顶部选择。', attr: { role: 'status' } }); }
      catch (e) { status.setText((e as Error).message); }
      finally { busy = false; b.setDisabled(false); }
    }));
    new Setting(el).setName('测试连接').setDesc('主动发送一条中性短消息，可能消耗服务额度，不发送项目内容。').addButton(b => b.setButtonText('测试连接').onClick(async () => {
      if (busy) return; busy = true; b.setDisabled(true); this.controller = new AbortController(); const controller = this.controller; status.setText('正在测试…');
      const candidate = { ...draft };
      try { await this.plugin.saveModelProfile(candidate, key); key = undefined; this.editingId = candidate.id; await this.plugin.chat.complete(candidate, this.plugin.getAISecret(candidate.id), [{ role: 'user', content: '请回复：连接成功。' }], controller.signal, 30000); status.setText('连接成功，已收到文字响应。'); }
      catch (e) { status.setText((e as Error).message); }
      finally { busy = false; b.setDisabled(false); }
    })).addButton(b => b.setButtonText('取消测试').onClick(() => this.controller?.abort()));
  }
}

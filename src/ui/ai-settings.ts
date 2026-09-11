import { PluginSettingTab, Setting, type App } from 'obsidian';
import type ObCanvasPlugin from '../main';
import { chatEndpoint } from '../ai/chat-client';
export class AISettingsTab extends PluginSettingTab {
  private controller?: AbortController;
  constructor(app: App, private plugin: ObCanvasPlugin) { super(app, plugin); }
  hide() { this.controller?.abort(); }
  display() {
    const el = this.containerEl; el.empty();
    el.createEl('h2', { text: 'AI 助手' });
    el.createEl('p', { text: '连接支持 Chat Completions 的文字模型。资产整理 Skill 可在剧本卡选择、复制修改或导入；图片和视频仍在外部生成。' });
    const draft = { ...this.plugin.aiSettings }; let key: string | undefined;
    new Setting(el).setName('服务地址').setDesc('填写版本路径，如 https://服务域名/v1，也支持完整 /chat/completions 地址。').addText(t => t.setPlaceholder('https://服务域名/v1').setValue(draft.baseUrl).onChange(v => { draft.baseUrl = v; }));
    new Setting(el).setName('模型名称').setDesc('填写服务商提供的模型标识。').addText(t => t.setValue(draft.model).onChange(v => { draft.model = v; }));
    new Setting(el).setName('API 密钥').setDesc(this.plugin.app.secretStorage ? '使用 Obsidian 密钥存储；留空且不编辑此栏会保留已有密钥。' : '当前宿主仅在本次会话保存密钥，重开后需要重新填写。').addText(t => { t.inputEl.type = 'password'; t.setPlaceholder(this.plugin.getAISecret() ? '已保存；输入可替换' : '无需密钥的服务可留空').onChange(v => { key = v; }); });
    const status = el.createEl('p', { attr: { role: 'status' } });
    let busy = false;
    const save = async () => { chatEndpoint(draft.baseUrl); if (!draft.model.trim()) throw new Error('请填写模型名称。'); await this.plugin.saveAISettings(draft, key); key = undefined; };
    new Setting(el).addButton(b => b.setButtonText('保存配置').setCta().onClick(async () => { if (busy) return; try { await save(); status.setText('配置已保存。'); } catch (e) { status.setText((e as Error).message); } }));
    new Setting(el).setName('测试连接').setDesc('主动发送一条中性短消息，可能消耗服务额度，不发送项目内容。').addButton(b => b.setButtonText('测试连接').onClick(async () => {
      if (busy) return; busy = true; b.setDisabled(true); this.controller = new AbortController(); status.setText('正在测试…');
      try { await save(); await this.plugin.chat.complete(this.plugin.aiSettings, this.plugin.getAISecret(), [{ role: 'user', content: '请回复：连接成功。' }], this.controller.signal, 30000); status.setText('连接成功，已收到文字响应；资产提取效果需在剧本中检验。'); }
      catch (e) { status.setText((e as Error).message); }
      finally { busy = false; b.setDisabled(false); }
    })).addButton(b => b.setButtonText('取消测试').onClick(() => this.controller?.abort()));
  }
}

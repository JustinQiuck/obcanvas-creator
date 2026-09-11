export type AISettings = { baseUrl: string; model: string };
export type ChatMessage = { role: 'system' | 'user'; content: string };
export type Transport = (request: { url: string; method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; text: string }>;
export const defaultAISettings: AISettings = { baseUrl: '', model: '' };
export function readAISettings(value: unknown): AISettings {
  if (value === undefined) return { ...defaultAISettings };
  if (!value || typeof value !== 'object' || !('baseUrl' in value) || typeof value.baseUrl !== 'string' || !('model' in value) || typeof value.model !== 'string') throw new Error('AI 设置格式无效，原配置已保留。');
  return { baseUrl: value.baseUrl, model: value.model };
}
export function chatEndpoint(baseUrl: string) {
  let url: URL;
  try { url = new URL(baseUrl.trim()); } catch { throw new Error('请填写完整的服务地址，例如 https://服务域名/v1。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('服务地址仅支持 HTTP(S)，不应包含密钥、查询参数或账号密码。');
  let path = url.pathname.replace(/\/+$/, '');
  if (!path) path = '/v1';
  if (!path.endsWith('/chat/completions')) path += '/chat/completions';
  url.pathname = path; return url.toString();
}
export class ChatClient {
  constructor(private transport: Transport) {}
  async complete(settings: AISettings, secret: string, messages: ChatMessage[], signal: AbortSignal, timeoutMs = 120000) {
    const url = chatEndpoint(settings.baseUrl);
    if (!settings.model.trim() || settings.model.length > 250) throw new Error('请先在 AI 助手设置中填写模型名称。');
    if (signal.aborted) throw new Error('已取消本次请求。');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel = () => {};
    try {
      const stopped = new Promise<never>((_, reject) => {
        cancel = () => reject(new Error('已取消本次请求。'));
        signal.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => reject(new Error('模型响应超时，请检查服务后手动重试。')), timeoutMs);
      });
      const response = await Promise.race([this.transport({ url, method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify({ model: settings.model.trim(), stream: false, messages }) }).catch(() => { throw new Error('无法连接模型服务，请检查地址与网络。'); }), stopped]);
      if (signal.aborted) throw new Error('已取消本次请求。');
      if (response.status < 200 || response.status >= 300) throw new Error(({ 401: '密钥无效或已过期。', 403: '服务拒绝访问，请检查模型权限。', 404: '接口或模型不存在，请检查版本路径及模型名称。', 429: '请求受限或额度不足，请检查服务。' } as Record<number, string>)[response.status] ?? `模型服务返回错误（${response.status}），请检查服务后重试。`);
      if (response.text.length > 2000000) throw new Error('模型响应过大，未载入结果。');
      let data: { choices?: { finish_reason?: string; message?: { content?: unknown } }[] };
      try { data = JSON.parse(response.text); } catch { throw new Error('服务未返回有效 JSON，请确认使用 Chat Completions 兼容接口。'); }
      const choice = data?.choices?.[0];
      if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error(choice.finish_reason === 'length' ? '模型输出被截断，请缩小本次剧本范围或调整服务端输出上限。' : '模型未完成文字输出，请检查该模型是否支持本次任务。');
      if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new Error('服务没有返回可用文字，请检查接口和模型。');
      return choice.message.content;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
  }
}

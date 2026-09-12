import { useState, useSyncExternalStore } from 'react';
import type { ModelProfiles } from '../ai/model-profiles';
export function ModelSelector({ models, blocked }: { models: ModelProfiles; blocked: boolean }) {
  const config = useSyncExternalStore(models.subscribe, models.getSnapshot);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  return <div className="obcanvas-model-selector"><label>文字模型<select aria-label="文字模型" value={config.selectedId} disabled={blocked || saving || !config.profiles.length} onChange={async e => {
    const id = e.target.value; setSaving(true); setError('');
    try { await models.select(id); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }}>{!config.profiles.length && <option value="">请先在插件设置中添加模型</option>}{config.profiles.map(p => <option key={p.id} value={p.id}>{p.name} · {p.model || '未填写模型'}</option>)}</select></label><small>用于后续资产整理和分镜任务 · 在插件设置中添加或编辑</small>{error && <p role="alert">{error}</p>}</div>;
}

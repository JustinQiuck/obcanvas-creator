import { useEffect, useState, useSyncExternalStore } from 'react';
import type { StoryboardSkill } from '../ai/storyboard-skill';
import type { VaultStoryboardSettings } from '../storage/vault-storyboard-settings';

export function StoryboardOptions({ settings, scriptId, projectId, busy, onDirty }: { settings: VaultStoryboardSettings; scriptId: string; projectId: string; busy: boolean; onDirty: (dirty: boolean) => void }) {
  const state = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
  const saved = settings.choice(scriptId, projectId), signature = JSON.stringify(saved);
  const [choice, setChoice] = useState(saved), [error, setError] = useState('');
  const [custom, setCustom] = useState<{ base?: StoryboardSkill; name: string; instructions: string }>();
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(choice) !== signature || !!custom;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  // Do not replace a dirty local form when another window writes configuration.
  const disabled = busy || saving || state.loading || state.busy || !!state.error;
  const selected = settings.skills().find(s => s.id === choice.skillId);
  const run = async (action: () => Promise<void>) => { setSaving(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } };
  return <section aria-label="分镜方法与作品方向">
    <label>分镜 Skill<select aria-label="分镜 Skill" disabled={disabled || !!custom} value={choice.skillId} onChange={e => setChoice({ ...choice, skillId: e.target.value })}>
      {!selected && <option value={choice.skillId}>所选分镜 Skill 已不存在</option>}
      {settings.skills().map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
    </select></label>
    <label>作品形式<select aria-label="作品形式" disabled={disabled} value={choice.format} onChange={e => setChoice({ ...choice, format: e.target.value as 'drama' | 'mv' })}><option value="drama">剧情影片</option><option value="mv">音乐 MV</option></select></label>
    <label>镜头风格与节奏<textarea aria-label="镜头风格与节奏" disabled={disabled} maxLength={4000} value={choice.direction} placeholder="例如：固定观察、延迟揭示；横屏 16:9。未知信息留空。" onChange={e => setChoice({ ...choice, direction: e.target.value })} /></label>
    {choice.format === 'mv' && <label>音乐段落与时间点<textarea aria-label="音乐段落与时间点" disabled={disabled} maxLength={4000} value={choice.musicTiming} placeholder="填写已确认的段落或时间点，并选择适用于 MV 的自定义分镜方法。" onChange={e => setChoice({ ...choice, musicTiming: e.target.value })} /></label>}
    <button disabled={disabled || !!custom || !dirty} onClick={() => void run(() => settings.saveChoice(scriptId, projectId, choice))}>保存分镜方法与方向</button>
    {dirty && <button disabled={disabled} onClick={() => { setChoice(settings.choice(scriptId, projectId)); setCustom(undefined); setError(''); }}>放弃分镜方法与方向修改</button>}
    <button disabled={disabled || !!custom || dirty} onClick={() => void run(() => settings.saveChoice(scriptId, projectId, choice, true))}>设为项目默认分镜方法</button>
    <button disabled={disabled || !!custom} onClick={() => void run(async () => { await settings.saveChoice(scriptId, projectId, choice, false, true); setChoice(settings.choice(scriptId, projectId)); })}>跟随项目默认分镜方法</button>
    {dirty && <p role="status">分镜方法有未保存修改，请保存后生成；历史预览不随方法变化重写。</p>}
    <details><summary>查看与自定义分镜规则</summary>
      {!custom && <><pre className="obcanvas-skill-snapshot">{selected?.instructions ?? '请选择有效方法。'}</pre>
        <button disabled={disabled || !selected} onClick={() => setCustom({ name: `${selected!.name} · 自定义`.slice(0, 100), instructions: selected!.instructions })}>复制分镜规则为自定义</button>
        {selected?.id.startsWith('custom-') && <button disabled={disabled} onClick={() => setCustom({ base: structuredClone(selected), name: selected.name, instructions: selected.instructions })}>编辑自定义分镜规则</button>}
      </>}
      {custom && <fieldset disabled={disabled}>
        <label>分镜规则名称<input aria-label="分镜规则名称" maxLength={100} value={custom.name} onChange={e => setCustom({ ...custom, name: e.target.value })} /></label>
        <label>分镜规则正文<textarea aria-label="分镜规则正文" rows={10} maxLength={20000} value={custom.instructions} onChange={e => setCustom({ ...custom, instructions: e.target.value })} /></label>
        <p>只填写分镜方法；输出格式由插件补齐，规则不会执行代码或自动加载外部文件。</p>
        <button disabled={!custom.name.trim() || !custom.instructions.trim()} onClick={() => void run(async () => { const skill = await settings.saveCustom(custom.name, custom.instructions, custom.base); const next = { ...choice, skillId: skill.id }; setChoice(next); setCustom(undefined); await settings.saveChoice(scriptId, projectId, next); })}>保存并选择分镜规则</button>
        <button onClick={() => setCustom(undefined)}>放弃规则修改</button>
      </fieldset>}
    </details>
    {(error || state.error) && <p role="alert">{error || state.error}<button disabled={state.busy} onClick={() => void run(() => settings.refresh())}>重新读取分镜配置</button></p>}
  </section>;
}

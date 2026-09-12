import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { exportSkillMarkdown, importSkillMarkdown, type AssetSkill } from '../ai/skill-model';
import type { VaultSkills } from '../storage/vault-skills';

export function AssetSkillPicker({ skills, scriptId, busy, projectId }: { skills: VaultSkills; scriptId: string; busy: boolean; projectId?: string }) {
  const state = useSyncExternalStore(skills.subscribe, skills.getSnapshot);
  const [managing, setManaging] = useState(false), [error, setError] = useState('');
  const choice = Object.hasOwn(state.config.scripts, scriptId) ? state.config.scripts[scriptId]! : '';
  const current = state.skills.find(s => s.id === skills.choice(scriptId, projectId));
  const disabled = busy || state.busy || state.loading || !!state.error;
  return <div className="obcanvas-skill-picker">
    <label>资产整理 Skill<select aria-label="资产整理 Skill" disabled={disabled} value={choice} onChange={e => { void skills.choose(e.target.value, scriptId).then(() => setError('')).catch(e => setError(e.message)); }}>
      <option value="">跟随项目默认 · {state.skills.find(s => s.id === skills.choice(undefined, projectId))?.name ?? 'Skill 已不存在'}</option>
      {choice && !state.skills.some(s => s.id === choice) && <option value={choice}>所选 Skill 已不存在，请重新选择</option>}
      {state.skills.map(s => <option key={s.id} value={s.id}>{s.name}{s.id.startsWith('custom-') ? ' · 自定义' : ''}</option>)}
    </select></label>
    <p className="obcanvas-hint">本次使用：{current?.name ?? '请选择有效 Skill'}。只提取资产，镜头语言与节奏属于分镜设计阶段。</p>
    <button disabled={busy || state.loading || state.busy} onClick={() => setManaging(true)}>管理 Skill</button>
    {(error || state.error) && <p role="alert">{error || state.error}<button onClick={() => { void skills.refresh(); setError(''); }}>重新读取 Skill</button></p>}
    {managing && <SkillManager skills={skills} projectId={projectId} initialId={current?.id} close={() => setManaging(false)} useSkill={async skill => { await skills.choose(skill.id, scriptId); setManaging(false); }} />}
  </div>;
}

function SkillManager({ skills, initialId, close, useSkill, projectId }: { skills: VaultSkills; initialId?: string; close: () => void; useSkill: (skill: AssetSkill) => Promise<void>; projectId?: string }) {
  const state = useSyncExternalStore(skills.subscribe, skills.getSnapshot), dialog = useRef<HTMLDialogElement>(null);
  const first = state.skills.find(s => s.id === initialId) ?? state.skills[0]!;
  const [base, setBase] = useState<AssetSkill | undefined>(first), [name, setName] = useState(first.name), [body, setBody] = useState(first.instructions);
  const [error, setError] = useState(''), [discard, setDiscard] = useState(false), [saving, setSaving] = useState(false);
  const builtin = !!base && !base.id.startsWith('custom-'), dirty = !base || name !== base.name || body !== base.instructions;
  const busy = saving || state.busy;
  useEffect(() => { dialog.current?.showModal(); }, []);
  function cancel() { if (busy) return; if (dirty) setDiscard(true); else close(); }
  function load(skill: AssetSkill) { setBase(skill); setName(skill.name); setBody(skill.instructions); setError(''); setDiscard(false); }
  function download() {
    const skill: AssetSkill = { id: base?.id ?? 'custom-export', name, instructions: body, stage: 'assets', version: base?.version ?? 'draft' };
    const blob = new Blob([exportSkillMarkdown(skill)], { type: 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob);
    const a = dialog.current!.ownerDocument.createElement('a'); a.href = url; a.download = `${name.replace(/[\\/:*?"<>|]/g, '_') || 'asset-skill'}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <dialog ref={dialog} className="obcanvas-skill-dialog" aria-label="管理资产 Skill" onKeyDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); cancel(); }}>
    <h2>管理资产 Skill</h2><p>写资产分析方法即可，输出格式由插件补齐。导入只读取 Markdown 文字，不加载附带文件或执行脚本。</p>
    <label>项目默认 Skill<select aria-label="项目默认 Skill" value={skills.choice(undefined, projectId)} disabled={busy || !!state.error} onChange={e => { void skills.choose(e.target.value, undefined, projectId).catch(e => setError(e.message)); }}>
      {!state.skills.some(s => s.id === skills.choice(undefined, projectId)) && <option value={skills.choice(undefined, projectId)}>原默认 Skill 已不存在</option>}
      {state.skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    <label>查看或编辑<select aria-label="查看或编辑 Skill" value={base?.id ?? ''} disabled={busy || dirty} onChange={e => { const skill = state.skills.find(s => s.id === e.target.value); if (skill) load(skill); }}>
      {!base && <option value="">新的自定义 Skill</option>}{state.skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    <div className="obcanvas-skill-actions"><button disabled={busy || dirty} onClick={() => { setBase(undefined); setName(`${name} · 自定义`.slice(0, 100)); }}>复制为自定义</button>
      <label>导入 Markdown<input aria-label="导入 Skill Markdown" type="file" accept=".md,text/markdown" disabled={busy || dirty} onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        setSaving(true);
        try { if (file.size > 120000) throw new Error('Skill 文件过大。'); const imported = importSkillMarkdown(await file.text(), file.name); setBase(undefined); setName(imported.name); setBody(imported.instructions); setError(''); }
        catch (e) { setError((e as Error).message); } finally { setSaving(false); }
      }} /></label><button disabled={busy || !body.trim()} onClick={download}>导出 Markdown</button></div>
    <label>Skill 名称<input aria-label="Skill 名称" value={name} readOnly={builtin} disabled={busy} maxLength={100} onChange={e => setName(e.target.value)} /></label>
    <label>资产整理规则<textarea aria-label="Skill 规则正文" value={body} readOnly={builtin} disabled={busy} maxLength={20000} onChange={e => setBody(e.target.value)} /></label>
    {builtin && <p>内置规则只读；点击“复制为自定义”即可修改。</p>}
    {(error || state.error) && <p role="alert">{error || state.error}<button disabled={busy} onClick={() => { void skills.refresh(); setError(''); }}>重新读取配置</button></p>}
    {discard && <p role="alert">有未保存的 Skill 修改。<button onClick={close}>放弃修改并关闭</button><button onClick={() => setDiscard(false)}>继续编辑</button></p>}
    <div className="obcanvas-skill-actions"><button disabled={busy} onClick={cancel}>关闭管理</button><button className="mod-cta" disabled={busy || !!state.error || !name.trim() || !body.trim()} onClick={async () => {
      setSaving(true); setError('');
      try { const saved = builtin ? base! : dirty ? await skills.saveCustom(name, body, base) : base!; load(saved); await useSkill(saved); }
      catch (e) { setError((e as Error).message); } finally { setSaving(false); }
    }}>{builtin ? '用于此剧本' : '保存并用于此剧本'}</button></div>
  </dialog>;
}

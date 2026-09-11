import { useEffect, useState, useSyncExternalStore } from 'react';
import { isProductionAsset, kindLabels, type FilmRecord } from '../model';
import { inputVersion, type AssetItem } from '../ai/extraction-model';
import type { ExtractionService } from '../ai/extraction-service';

export function ExtractionPanel({ script, records, service, start, apply, openAsset }: { script: FilmRecord; records: FilmRecord[]; service: ExtractionService; start: () => void; apply: () => void; openAsset: (id: string) => void }) {
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const task = state.tasks.find(t => t.scriptId === script.id);
  const [version, setVersion] = useState(''), [error, setError] = useState('');
  useEffect(() => { let active = true; void inputVersion(script).then(v => { if (active) setVersion(v); }); return () => { active = false; }; }, [script.id, script.body, script.title, script.sceneId]);
  const stale = !!task && version !== task.inputVersion;
  function update(item: AssetItem, patch: Partial<AssetItem>) {
    if (!task) return;
    try { service.editDraft(task, { ...task, items: task.items.map(i => i.id === item.id ? { ...i, ...patch } : i) }); setError(''); }
    catch (e) { setError((e as Error).message); }
  }
  return <section className="obcanvas-extraction" aria-label="拍摄资产清单">
    <h3>拍摄资产</h3><p className="obcanvas-hint">整理将发送当前剧本与项目已有资产的文字摘要给你配置的模型。图片留在本地。</p>
    <button className="mod-cta" disabled={state.busy} onClick={start}>{task ? '按当前剧本重新整理' : '整理拍摄资产'}</button>
    {state.busy && <button onClick={() => service.cancel()}>取消分析</button>}
    {state.message && <p role="status">{state.message}</p>}{error && <p role="alert">{error}</p>}
    {task && <>
      <p className="obcanvas-hint">{task.status === 'complete' ? '这次清单已确认。资产卡可以继续绑定图片。' : '先核对名称、原文依据和复用建议。修改自动保存，确认后才创建卡片。'} · {task.items.length} 项</p>
      {stale && <p role="alert">剧本已更新；此清单仅供对照，请按当前剧本重新整理。</p>}
      {!task.items.length && <p>本次未提取到需要准备的资产。</p>}
      {task.status === 'complete' && task.items.filter(i => i.action !== 'ignore').map(i => <button className="obcanvas-task" key={i.id} onClick={() => openAsset(i.targetId)}>绑定参考图 · {records.find(r => r.id === i.targetId)?.title ?? i.title}</button>)}
      {task.items.map(item => <fieldset className="obcanvas-asset-item" key={item.id} disabled={state.busy || task.status !== 'review' || stale}>
        <legend>{kindLabels[item.kind]}{item.applied ? ' · 已处理' : ''}</legend>
        <label>名称<input aria-label="资产名称" value={item.title} onChange={e => update(item, { title: e.target.value })} /></label>
        <blockquote>{item.evidence}</blockquote>
        <label>处理方式<select aria-label="资产处理方式" value={item.action} onChange={e => update(item, { action: e.target.value as AssetItem['action'], targetId: e.target.value === 'create' ? crypto.randomUUID() : e.target.value === 'ignore' ? item.targetId : records.find(r => r.kind === item.kind)?.id ?? '' })}><option value="create">新建资产卡</option><option value="reuse">复用已有资产</option><option value="ignore">本次忽略</option></select></label>
        {item.action === 'reuse' ? <><label>已有资产<select aria-label="复用资产" value={item.targetId} onChange={e => update(item, { targetId: e.target.value })}><option value="">请选择</option>{records.filter(r => isProductionAsset(r) && r.kind === item.kind).map(r => <option key={r.id} value={r.id}>{r.title} · {r.path.split('/').pop()}</option>)}</select></label><p className="obcanvas-hint">仅增加剧本关联，保留已有外观描述与图片。</p></> : <>
          <label>剧本明确的信息<textarea aria-label="资产描述" value={item.description} onChange={e => update(item, { description: e.target.value })} /></label>
          <label>待确认信息（每行一项）<textarea aria-label="资产待确认信息" value={item.unresolved.join('\n')} onChange={e => update(item, { unresolved: e.target.value.split('\n') })} /></label>
          <label>需要的参考用途（每行一项）<textarea aria-label="资产参考用途" value={item.needs.join('\n')} onChange={e => update(item, { needs: e.target.value.split('\n') })} /></label>
        </>}
        {task.items.some(i => i.id !== item.id && i.kind === item.kind && i.action !== 'ignore') && <label>与本次另一项合并<select aria-label="合并清单项" value="" onChange={e => {
          const target = task.items.find(i => i.id === e.target.value); if (!target) return;
          try { service.editDraft(task, { ...task, items: task.items.map(i => i.id === item.id ? { ...i, action: 'ignore' } : i.id === target.id ? { ...i, description: [i.description, item.description].filter(Boolean).join('\n'), unresolved: [...new Set([...i.unresolved, ...item.unresolved])], needs: [...new Set([...i.needs, ...item.needs])] } : i) }); } catch (e) { setError((e as Error).message); }
        }}><option value="">选择合并目标…</option>{task.items.filter(i => i.id !== item.id && i.kind === item.kind && i.action !== 'ignore').map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>}
      </fieldset>)}
      <button disabled={state.busy || !service.hasDrafts()} onClick={() => void service.flushDrafts().catch(e => setError((e as Error).message))}>保存清单修改</button>
      <button className="mod-cta" disabled={state.busy || stale || task.status === 'complete'} onClick={apply}>{task.status === 'partial' || task.status === 'applying' ? '继续保存未完成项' : '确认并生成资产卡'}</button>
    </>}
  </section>;
}

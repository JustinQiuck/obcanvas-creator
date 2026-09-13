import { useEffect, useState, useSyncExternalStore } from 'react';
import { projectOf, type FilmRecord } from '../model';
import { StoryboardOptions } from './storyboard-options';
import { storyboardAssets, storyboardInputVersion, type StoryboardItem } from '../ai/storyboard-model';
import type { StoryboardService } from '../ai/storyboard-service';

export function StoryboardPanel({ script, records, service, start, blocked = false, onOptionsDirty }: { script: FilmRecord; records: FilmRecord[]; service: StoryboardService; start: () => void; blocked?: boolean; onOptionsDirty?: (dirty: boolean) => void }) {
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  const [selectedTask, setSelectedTask] = useState('');
  const tasks = state.tasks.filter(item => item.scriptId === script.id);
  const task = tasks.find(item => item.id === selectedTask) ?? tasks[0];
  const assets = storyboardAssets(script, records);
  const [version, setVersion] = useState(''), [error, setError] = useState(''), [optionsDirty, setOptionsDirty] = useState(false), [confirming, setConfirming] = useState(false);
  useEffect(() => { onOptionsDirty?.(optionsDirty); return () => onOptionsDirty?.(false); }, [optionsDirty, onOptionsDirty]);
  useEffect(() => { setConfirming(false); setError(''); }, [task?.id]);
  useEffect(() => {
    let active = true;
    void storyboardInputVersion(script, records).then(value => { if (active) setVersion(value); }).catch(() => { if (active) setVersion('invalid'); });
    return () => { active = false; };
  }, [script, records]);
  const stale = !!task && !!version && version !== task.inputVersion;
  function update(item: StoryboardItem, patch: Partial<StoryboardItem>) {
    if (!task) return;
    try { service.editDraft(task, { ...task, items: task.items.map(current => current.id === item.id ? { ...current, ...patch } : current) }); setError(''); }
    catch (cause) { setError((cause as Error).message); }
  }
  function remove(item: StoryboardItem) {
    if (!task) return;
    try { service.editDraft(task, { ...task, items: task.items.filter(current => current.id !== item.id) }); setError(''); }
    catch (cause) { setError((cause as Error).message); }
  }
  const disabled = state.busy || blocked;
  return <section className="obcanvas-storyboard" aria-label="分镜与关键帧预览">
    <h3>分镜与关键帧</h3>
    {service.preferences && <StoryboardOptions settings={service.preferences} scriptId={script.id} projectId={projectOf(script, records)} busy={disabled} onDirty={setOptionsDirty} />}
    <p className="obcanvas-hint">读取当前剧本和已关联的 {assets.length} 项拍摄资产文字信息，帮你判断哪里该用特写、全景或固定机位。图片不会发送。</p>
    {!!assets.length && <details><summary>本次可用资产</summary><ul>{assets.map(asset => <li key={asset.id}>{asset.title}{asset.assetDetails?.unresolved.length ? ` · 仍有 ${asset.assetDetails.unresolved.length} 项待确认` : ''}</li>)}</ul></details>}
    {!assets.length && <p className="obcanvas-hint">尚未关联拍摄资产；可以先生成结构预览，人物外观和空间细节会保留为 TBD。</p>}
    <button className="mod-cta" disabled={disabled || optionsDirty} onClick={() => { setSelectedTask(''); setConfirming(false); start(); }}>{state.busy && state.scriptId === script.id ? '正在设计…' : task ? '重新生成分镜预览' : '生成分镜预览'}</button>
    {state.busy && state.scriptId === script.id && <button onClick={() => service.cancel()}>取消分镜设计</button>}
    {state.message && (!state.scriptId || state.scriptId === script.id) && <p role="status">{state.message}</p>}
    {error && <p role="alert">{error}</p>}
    {tasks.length > 1 && <label>分镜历史<select aria-label="分镜历史" disabled={disabled || service.hasDrafts()} value={task?.id} onChange={event => setSelectedTask(event.target.value)}>{tasks.map(item => <option key={item.id} value={item.id}>{item.createdAt} · {item.skill.name} · {({ review: '待确认', applying: '保存中断，可继续', partial: '部分保存', complete: '已入卡' })[item.status]}</option>)}</select></label>}
    {task && <>
      <p className="obcanvas-hint">本次使用：{task.skill.name} · {task.items.length} 镜。{task.status === 'complete' ? '此预览已确认入卡；请在正式镜头中继续编辑。' : task.status === 'review' ? '检查并确认后才会创建正式镜头。' : '入卡尚未完成，已保存部分保留。'}</p>
      <details><summary>查看本次分镜规则</summary><pre className="obcanvas-skill-snapshot">{task.skill.instructions}</pre></details>
      {stale && <p role="alert">剧本或已关联资产已更新；此预览仅供对照，请按最新内容重新生成。</p>}
      {!!task.issues?.length && <div role="alert"><p>以下 {task.issues.length} 镜未进入预览：</p><ul>{task.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul><p>重新生成会再次请求模型，请先根据原因检查剧本或模型设置。</p></div>}
      {!task.items.length && <p>{task.issues?.length ? '本次没有通过检查的分镜，未创建任何镜头卡。' : '剧本没有生成可用的分镜预览。'}</p>}
      {task.items.map((item, index) => <fieldset className="obcanvas-storyboard-item" key={item.id} disabled={disabled || stale || task.status !== 'review'}>
        <legend>{String(index + 1).padStart(2, '0')} · {item.title}</legend>
        <label>镜头名称<input aria-label={`镜头 ${index + 1} 名称`} value={item.title} onChange={event => update(item, { title: event.target.value })} /></label>
        <label>剧本原文依据<blockquote>{item.evidence}</blockquote></label>
        <label>为什么拍这一镜<textarea aria-label={`镜头 ${index + 1} 拍摄理由`} value={item.intent} onChange={event => update(item, { intent: event.target.value })} /></label>
        <label>景别与构图<textarea aria-label={`镜头 ${index + 1} 景别与构图`} value={item.framing} onChange={event => update(item, { framing: event.target.value })} /></label>
        <label>机位与摄影机<textarea aria-label={`镜头 ${index + 1} 机位与摄影机`} value={item.camera} onChange={event => update(item, { camera: event.target.value })} /></label>
        <label>起点<textarea aria-label={`镜头 ${index + 1} 起点`} value={item.start} onChange={event => update(item, { start: event.target.value })} /></label>
        <label>本镜动作<textarea aria-label={`镜头 ${index + 1} 动作`} value={item.action} onChange={event => update(item, { action: event.target.value })} /></label>
        <label>终点<textarea aria-label={`镜头 ${index + 1} 终点`} value={item.end} onChange={event => update(item, { end: event.target.value })} /></label>
        <label>声音<textarea aria-label={`镜头 ${index + 1} 声音`} value={item.sound} onChange={event => update(item, { sound: event.target.value })} /></label>
        <label>静态起始关键帧提示词<textarea aria-label={`镜头 ${index + 1} 静态起始关键帧提示词`} value={item.keyframePrompt} onChange={event => update(item, { keyframePrompt: event.target.value })} /></label>
        <label>成片计划时长（秒）<input aria-label={`镜头 ${index + 1} 成片计划时长`} type="number" min="0.1" max="120" step="0.1" value={item.plannedDurationSeconds} onChange={event => { if (event.target.value && Number.isFinite(event.target.valueAsNumber)) update(item, { plannedDurationSeconds: event.target.valueAsNumber }); }} /></label>
        <button type="button" onClick={() => remove(item)}>从本次预览移除</button>
      </fieldset>)}
      <button disabled={state.busy || task.status !== 'review' || !service.hasDrafts()} onClick={() => void service.flushDrafts().catch(cause => setError((cause as Error).message))}>保存分镜预览修改</button>
      {task.direction && <p className="obcanvas-hint">本次作品方向：{task.direction.format === 'mv' ? '音乐 MV' : '剧情影片'} · {task.direction.direction || '未补充风格'}{task.direction.musicTiming && ` · ${task.direction.musicTiming}`}</p>}
      {task.status !== 'complete' && <button className="mod-cta" disabled={disabled || stale || !version || service.hasDrafts() || !task.items.length || !!task.issues?.length} onClick={() => setConfirming(true)}>{task.status === 'review' ? '检查正式入卡' : '检查并继续保存镜头'}</button>}
      {confirming && <section role="region" aria-label="确认分镜入卡">
        <p>{task.status === 'review' ? `本次新增 ${task.items.length} 个正式镜头` : `继续保存 ${task.items.length} 个已分配编号的镜头`}；当前项目已有 {records.filter(r => r.kind === 'shot').length} 个镜头，保留原有内容、素材与采用决定。</p>
        <p>正文保存本镜动作，拍摄理由、景别、机位、起止状态、声音、静态关键帧和计划剪辑时长分别保存。新预览不会自动替换旧镜头。</p>
        <button disabled={disabled || stale || service.hasDrafts()} onClick={() => void service.apply(task).then(() => { setConfirming(false); setError(''); }).catch(e => setError(e.message))}>确认保存正式镜头</button>
        <button disabled={disabled} onClick={() => setConfirming(false)}>取消入卡</button>
      </section>}
    </>}
  </section>;
}

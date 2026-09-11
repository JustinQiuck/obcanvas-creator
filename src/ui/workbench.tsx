import { useEffect, useState, useSyncExternalStore } from 'react';
import { EditorSession } from '../editor-session';
import { VaultRecords, errorMessage } from '../storage/vault-records';
import { VaultLayout, defaultScene } from '../storage/vault-layout';
import { VaultMedia } from '../storage/vault-media';
import { InfiniteCanvas } from '../canvas/infinite-canvas';
import { ShotCard } from '../canvas/shot-card';
import { MediaPanel } from './media-panel';
import { Viewports } from '../canvas/viewports';
import { orderedShots, shotStatus } from '../model';
const labels = { ready: '已载入', dirty: '未保存', saved: '已保存', changed: '笔记有更新', error: '操作失败', conflict: '内容冲突' };
export function Workbench({ records, editor, layout, viewports, media, openNote }: { records: VaultRecords; editor: EditorSession; layout: VaultLayout; viewports: Viewports; media: VaultMedia; openNote: (path: string) => Promise<void> }) {
  const catalog = useSyncExternalStore(records.subscribe, records.getSnapshot);
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const layoutState = useSyncExternalStore(layout.subscribe, layout.getSnapshot);
  const viewState = useSyncExternalStore(viewports.subscribe, viewports.getSnapshot);
  useSyncExternalStore(media.subscribe, media.getSnapshot);
  const [sceneId, setSceneId] = useState(state.base?.sceneId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scenes = catalog.records.filter(r => r.kind === 'scene');
  const selected = catalog.records.find(r => r.id === state.selectedId && r.kind === 'shot');
  const activeScene = selected?.sceneId ?? (sceneId || scenes[0]?.id || '');
  const scene = scenes.find(s => s.id === activeScene);
  const shots = orderedShots(scene, catalog.records);
  const sceneLayout = Object.hasOwn(layoutState.data.scenes, activeScene) ? layoutState.data.scenes[activeScene]! : defaultScene();
  const viewport = Object.hasOwn(viewState, activeScene) ? viewState[activeScene]! : sceneLayout.viewport;
  const blocked = state.dirty || state.saving || busy;
  useEffect(() => {
    if (layoutState.status === 'loading' || layoutState.status === 'error') return;
    if (activeScene && !Object.hasOwn(viewState, activeScene)) viewports.update(activeScene, sceneLayout.viewport);
    let nextIndex = Object.keys(sceneLayout.positions).length;
    shots.forEach(shot => {
      if (!Object.hasOwn(sceneLayout.positions, shot.id)) {
        const index = nextIndex++;
        layout.update(activeScene, { x: (index % 3) * 292, y: Math.floor(index / 3) * 230 }, shot.id);
      }
    });
  }, [activeScene, shots.map(s => s.id).join('|'), layoutState.status, layout, viewports, viewState]);
  useEffect(() => {
    if (!state.selectedId && shots[0]) editor.select(shots[0].id);
  }, [editor, state.selectedId, shots[0]?.id]);
  async function create(kind: 'scene' | 'shot') {
    setBusy(true); setError('');
    try {
      const record = await records.create(kind, kind === 'shot' ? activeScene : undefined);
      if (kind === 'scene') { setSceneId(record.id); editor.clearSelection(); }
      else editor.select(record.id);
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function move(id: string, direction: -1 | 1) {
    if (!scene) return;
    setBusy(true); setError('');
    try { await records.moveShot(scene, id, direction); }
    catch (e) { setError(errorMessage(e)); }
    finally { await records.refresh(); setBusy(false); }
  }
  return <section className="obcanvas-workbench" aria-label="影视画布工作台" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); void editor.save(); }
  }}>
    <header className="obcanvas-header"><div><h1>影视画布</h1><p>镜头卡与笔记，共用一份制作记录。</p></div><span className="obcanvas-stage">本地笔记同步</span></header>
    {catalog.problems.length > 0 && <div className="obcanvas-alert" role="alert">{catalog.problems.map(problem => <p key={problem}>{problem}</p>)}<button onClick={() => void records.refresh()}>重新读取</button></div>}
    {error && <p className="obcanvas-alert" role="alert">{error}</p>}
    <div className="obcanvas-tools">
      <label>当前场次 <select aria-label="当前场次" value={activeScene} disabled={blocked} onChange={event => { setSceneId(event.target.value); editor.clearSelection(); }}>
        {!scenes.length && <option value="">尚无场次</option>}
        {scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
      </select></label>
      <button disabled={blocked || catalog.loading} onClick={() => void create('scene')}>新建场次</button>
      <button disabled={blocked || !activeScene} onClick={() => void create('shot')}>添加镜头</button>
      {blocked && state.dirty && <span className="obcanvas-hint">请先保存当前镜头，再切换场次。</span>}
    </div>
    <div className="obcanvas-progress" aria-label="场次制作进度">{(['待规划', '待素材', '待选片', '待重做', '已采用'] as const).map(status => <span key={status} data-progress={status}>{status} {shots.filter(s => shotStatus(s) === status).length}</span>)}</div>
    <nav className="obcanvas-order" aria-label="镜头顺序"><h2>镜头顺序</h2><p className="obcanvas-hint">用上移／下移调整成片顺序，画布卡片位置保持不变。</p>
      {shots.map((shot, index) => <div key={shot.id} data-order-shot={shot.id}>
        <button disabled={blocked && selected?.id !== shot.id} aria-pressed={selected?.id === shot.id} onClick={() => editor.select(shot.id)}>{String(index + 1).padStart(2, '0')} · {shot.title}</button>
        <span data-shot-status={shotStatus(shot)}>{shotStatus(shot)}</span>
        {(shot.media ?? []).some(ref => !!media.locate(ref).error) && <span className="obcanvas-missing">素材缺失／无法读取</span>}
        <button aria-label={`上移镜头：${shot.title}`} disabled={blocked || index === 0} onClick={() => void move(shot.id, -1)}>上移</button>
        <button aria-label={`下移镜头：${shot.title}`} disabled={blocked || index === shots.length - 1} onClick={() => void move(shot.id, 1)}>下移</button>
      </div>)}
    </nav>
    {catalog.loading ? <p role="status">正在读取镜头记录…</p> : <div className="obcanvas-columns">
      <div className="obcanvas-board">
        <InfiniteCanvas key={activeScene} viewport={viewport} onViewportChange={v => { viewports.update(activeScene, v); layout.update(activeScene, v); }}>
          {shots.map((shot, index) => <ShotCard key={shot.id} shot={shot} number={index + 1} missing={(shot.media ?? []).some(ref => !!media.locate(ref).error)} position={Object.hasOwn(sceneLayout.positions, shot.id) ? sceneLayout.positions[shot.id]! : { x: (index % 3) * 292, y: Math.floor(index / 3) * 230 }} scale={viewport.k} selected={state.selectedId === shot.id} disabled={blocked && state.selectedId !== shot.id} onSelect={() => editor.select(shot.id)} onMove={p => layout.update(activeScene, p, shot.id)} />)}
        </InfiniteCanvas>
        <p className="obcanvas-hint">滚轮缩放 · 空白处按住空格或选择“平移”拖动画布 · 拖动卡片整理位置</p>
        <p className="obcanvas-hint" data-layout-status={layoutState.status}>{layoutState.status === 'saved' ? '布局已保存' : layoutState.status === 'pending' ? '正在保存布局…' : layoutState.status === 'loading' ? '正在读取布局…' : layoutState.message}</p>
        {layoutState.status === 'error' && <button onClick={() => void layout.flush().then(() => layout.refresh()).catch(() => {})}>重试保存布局</button>}
      </div>
      {state.base ? <article className="obcanvas-shot-card">
        <fieldset className="obcanvas-editor-fields" disabled={busy}>
        <div className="obcanvas-card-heading"><h2>镜头记录</h2><span role="status" data-save-status={state.saving ? 'saving' : state.status}>{state.saving ? '保存中…' : labels[state.status]}</span></div>
        <label>镜头标题<input type="text" aria-label="镜头标题" value={state.draft.title} disabled={state.saving} onChange={e => editor.edit('title', e.target.value)} placeholder="例如：走廊里的脚步" /></label>
        <label>镜头内容<textarea aria-label="镜头内容" value={state.draft.body} disabled={state.saving} onChange={e => editor.edit('body', e.target.value)} placeholder="记录画面、动作，以及这个镜头为什么需要出现。" rows={12} /></label>
        <details><summary>镜头规划（理由、景别、机位）</summary><label>拍摄理由<input type="text" aria-label="拍摄理由" value={state.draft.intent ?? ''} disabled={state.saving} onChange={e => editor.edit('intent', e.target.value)} placeholder="这个镜头需要让观众看到或感受到什么？" /></label>
        <label>景别<select aria-label="景别" value={state.draft.framing ?? ''} disabled={state.saving} onChange={e => editor.edit('framing', e.target.value)}><option value="">待确定</option>{['远景', '全景', '中景', '近景', '特写'].map(v => <option key={v}>{v}</option>)}{state.draft.framing && !['远景', '全景', '中景', '近景', '特写'].includes(state.draft.framing) && <option>{state.draft.framing}</option>}</select></label>
        <label>机位与运动<input type="text" aria-label="机位与运动" value={state.draft.camera ?? ''} disabled={state.saving} onChange={e => editor.edit('camera', e.target.value)} placeholder="例如：门边平视，固定机位" /></label></details>
        <details><summary>提示词与来源（可选）</summary><label>原提示词<textarea aria-label="原提示词" rows={4} value={state.draft.prompt ?? ''} disabled={state.saving} onChange={e => editor.edit('prompt', e.target.value)} /></label><label>来源备注<input type="text" aria-label="来源备注" value={state.draft.source ?? ''} disabled={state.saving} onChange={e => editor.edit('source', e.target.value)} placeholder="可粘贴工作流链接或生成来源" /></label></details>
        {state.message && <p role={state.status === 'error' || state.status === 'conflict' ? 'alert' : 'status'} className="obcanvas-message">{state.message}</p>}
        <footer><button className="mod-cta" disabled={!state.dirty || state.saving} onClick={() => void editor.save()}>{state.status === 'error' ? '重试保存' : '保存到笔记'}</button>
          <button disabled={!selected} onClick={() => { if (selected) void openNote(selected.path).catch(e => setError(errorMessage(e))); }}>打开对应笔记</button>
          {state.dirty && <button disabled={state.saving || !selected} onClick={() => void editor.loadLatest()}>放弃本地修改，载入笔记</button>}
        </footer>
        <p className="obcanvas-hint">未保存的输入会单独备份为草稿，重新打开视图后可继续编辑。</p>
        {selected && <MediaPanel key={selected.id} shot={selected} media={media} />}
        </fieldset>
      </article> : <div className="obcanvas-empty"><h2>{scenes.length ? '从一张镜头卡开始' : '建立第一场戏'}</h2><p>{scenes.length ? '点击“添加镜头”，填写标题和内容。' : '点击“新建场次”，再添加镜头。资料会保存为库内的普通笔记。'}</p></div>}
    </div>}
  </section>;
}

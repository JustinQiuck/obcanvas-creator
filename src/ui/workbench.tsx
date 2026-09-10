import { useEffect, useState, useSyncExternalStore } from 'react';
import { EditorSession } from '../editor-session';
import { VaultRecords, errorMessage } from '../storage/vault-records';
const labels = { ready: '已载入', dirty: '未保存', saved: '已保存', changed: '笔记有更新', error: '操作失败', conflict: '内容冲突' };
export function Workbench({ records, editor, openNote }: { records: VaultRecords; editor: EditorSession; openNote: (path: string) => Promise<void> }) {
  const catalog = useSyncExternalStore(records.subscribe, records.getSnapshot);
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [sceneId, setSceneId] = useState(state.base?.sceneId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scenes = catalog.records.filter(r => r.kind === 'scene');
  const selected = catalog.records.find(r => r.id === state.selectedId && r.kind === 'shot');
  const activeScene = selected?.sceneId ?? (sceneId || scenes[0]?.id || '');
  const shots = catalog.records.filter(r => r.kind === 'shot' && r.sceneId === activeScene);
  const blocked = state.dirty || state.saving || busy;
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
    {catalog.loading ? <p role="status">正在读取镜头记录…</p> : <div className="obcanvas-columns">
      <nav className="obcanvas-shot-list" aria-label="镜头列表">
        <h2>镜头</h2>{shots.map((shot, index) => <button key={shot.id} className={state.selectedId === shot.id ? 'is-selected' : ''} disabled={blocked && state.selectedId !== shot.id} onClick={() => editor.select(shot.id)}><span>{String(index + 1).padStart(2, '0')}</span>{shot.title}</button>)}
        {!shots.length && <p>添加一张镜头卡，开始记录拍摄内容。</p>}
      </nav>
      {state.base ? <article className="obcanvas-shot-card">
        <div className="obcanvas-card-heading"><h2>镜头记录</h2><span role="status" data-save-status={state.saving ? 'saving' : state.status}>{state.saving ? '保存中…' : labels[state.status]}</span></div>
        <label>镜头标题<input type="text" aria-label="镜头标题" value={state.draft.title} disabled={state.saving} onChange={e => editor.edit('title', e.target.value)} placeholder="例如：走廊里的脚步" /></label>
        <label>镜头内容<textarea aria-label="镜头内容" value={state.draft.body} disabled={state.saving} onChange={e => editor.edit('body', e.target.value)} placeholder="记录画面、动作，以及这个镜头为什么需要出现。" rows={12} /></label>
        {state.message && <p role={state.status === 'error' || state.status === 'conflict' ? 'alert' : 'status'} className="obcanvas-message">{state.message}</p>}
        <footer><button className="mod-cta" disabled={!state.dirty || state.saving} onClick={() => void editor.save()}>{state.status === 'error' ? '重试保存' : '保存到笔记'}</button>
          <button disabled={!selected} onClick={() => { if (selected) void openNote(selected.path).catch(e => setError(errorMessage(e))); }}>打开对应笔记</button>
          {state.dirty && <button disabled={state.saving || !selected} onClick={() => void editor.loadLatest()}>放弃本地修改，载入笔记</button>}
        </footer>
        <p className="obcanvas-hint">未保存的输入会单独备份为草稿，重新打开视图后可继续编辑。</p>
      </article> : <div className="obcanvas-empty"><h2>{scenes.length ? '从一张镜头卡开始' : '建立第一场戏'}</h2><p>{scenes.length ? '点击“添加镜头”，填写标题和内容。' : '点击“新建场次”，再添加镜头。资料会保存为库内的普通笔记。'}</p></div>}
    </div>}
  </section>;
}

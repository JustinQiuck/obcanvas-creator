import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FilmRecord } from '../model';
import { moveVisibleOrder, projectOrderView, type ProjectOrderDraft } from '../project-order';
import { errorMessage, type VaultRecords } from '../storage/vault-records';

export function ProjectOrderPanel({ project, records, blocked, onDirty }: { project: FilmRecord; records: VaultRecords; blocked: boolean; onDirty: (dirty: boolean) => void }) {
  const catalog = useSyncExternalStore(records.subscribe, records.getSnapshot);
  const [draft, setDraft] = useState<ProjectOrderDraft>(), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [sceneId, setSceneId] = useState('');
  useEffect(() => { onDirty(!!draft); return () => onDirty(false); }, [!!draft, onDirty]);
  const view = projectOrderView(project, catalog.records), shots = [...view.ordered, ...view.pending];
  const byId = new Map(shots.map(r => [r.id, r]));
  const ids = draft?.ids ?? project.editOrder ?? [], ordered = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  const pending = shots.filter(r => !ids.includes(r.id)), missing = ids.filter(id => !byId.has(id));
  const displayed = ordered.filter(r => !sceneId || r.sceneId === sceneId);
  const scenes = catalog.records.filter(r => r.kind === 'scene' && shots.some(s => s.sceneId === r.id));
  const disabled = blocked || busy || !!catalog.problems.length;
  async function run(action: () => Promise<void>) { if (disabled) return; setBusy(true); setError(''); setMessage(''); try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  return <section className="obcanvas-project-order" aria-label="全片镜头顺序">
    <h3>全片镜头顺序</h3>
    <p>安排整个项目的剪辑先后，可跨场次排列。{project.editOrder === undefined ? '尚未确认全片顺序；先检查旧场次顺序组成的草案。' : `已排 ${view.ordered.length} 镜，待排 ${view.pending.length} 镜。`}</p>
    {!draft && <button disabled={disabled || !shots.length} onClick={() => void run(async () => { setDraft(await records.prepareProjectOrder(project.id)); setSceneId(''); })}>{project.editOrder === undefined ? '整理全片顺序草案' : '调整全片顺序'}</button>}
    {draft && <p role="status">正在编辑顺序草案。检查场次先后并确认保存；原笔记、素材和镜头内容保留。</p>}
    {(project.editOrder !== undefined || draft) && <>
      <label>顺序查看范围<select aria-label="顺序查看范围" disabled={busy} value={sceneId} onChange={e => setSceneId(e.target.value)}><option value="">全片</option>{scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select></label>
      {draft && sceneId && <p>场次列表显示全片位置；切回“全片”可调整跨场次顺序。</p>}
      <ol className="obcanvas-film-order-list">{displayed.map(shot => <li key={shot.id} data-film-order-shot={shot.id}>
        <span className="obcanvas-order-number">{ordered.indexOf(shot) + 1}</span><div><strong>{shot.title}</strong><small>{catalog.records.find(r => r.id === shot.sceneId)?.title ?? '场次待恢复'}{shot.plannedDuration && ` · 计划 ${shot.plannedDuration} 秒`}</small><p>{shot.intent || shot.body || '镜头内容待补充'}</p></div>
        {draft && <span><button aria-label={`全片上移：${shot.title}`} disabled={disabled || !!sceneId || ordered.indexOf(shot) === 0} onClick={() => setDraft({ ...draft, ids: moveVisibleOrder(ids, new Set(byId.keys()), shot.id, -1) })}>上移</button><button aria-label={`全片下移：${shot.title}`} disabled={disabled || !!sceneId || ordered.indexOf(shot) === ordered.length - 1} onClick={() => setDraft({ ...draft, ids: moveVisibleOrder(ids, new Set(byId.keys()), shot.id, 1) })}>下移</button></span>}
      </li>)}</ol>
      {!displayed.length && <p>此范围还没有已排镜头。</p>}
    </>}
    {!!pending.length && <details open={!!draft}><summary>待排镜头 · {pending.length}</summary>{pending.map(shot => <div key={shot.id} data-pending-shot={shot.id}>{shot.title}{draft && <button disabled={disabled} aria-label={`排到片尾：${shot.title}`} onClick={() => setDraft({ ...draft, ids: [...draft.ids, shot.id] })}>排到片尾</button>}</div>)}</details>}
    {!!missing.length && <p>{missing.length} 个原镜头暂时缺失，原位置已保留；恢复笔记后重新显示。</p>}
    {draft && <div><button className="mod-cta" disabled={disabled} onClick={() => void run(async () => { await records.saveProjectOrder(draft); setDraft(undefined); setMessage('全片顺序已保存。'); })}>确认保存全片顺序</button><button disabled={busy} onClick={() => { setDraft(undefined); setError(''); setMessage('顺序草案已放弃，原顺序保留。'); }}>放弃顺序修改</button></div>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { EditorSession } from '../editor-session';
import { VaultRecords, errorMessage } from '../storage/vault-records';
import { VaultLayout, defaultScene } from '../storage/vault-layout';
import { VaultMedia, mediaKind } from '../storage/vault-media';
import { InfiniteCanvas } from '../canvas/infinite-canvas';
import { BoardCard } from '../canvas/board-card';
import { buildGraph, type BoardNode, type BoardEdge } from '../canvas/graph';
import { Preview } from './media-panel';
import { RecordInspector } from './record-inspector';
import { ExtractionPanel } from './extraction-panel';
import { AssetPreparation } from './asset-preparation';
import type { ExtractionService } from '../ai/extraction-service';
import { Viewports } from '../canvas/viewports';
import { orderedShots, shotStatus, kindLabels, linkRoles, draftOf, isVideoPath, type RecordKind, type CardLink } from '../model';
import { isProductionAsset, assetStatus } from '../model';

export function Workbench({ records, editor, layout, viewports, media, openNote, extractions, owner }: { records: VaultRecords; editor: EditorSession; layout: VaultLayout; viewports: Viewports; media: VaultMedia; openNote: (path: string) => Promise<void>; extractions: ExtractionService; owner: string }) {
  const catalog = useSyncExternalStore(records.subscribe, records.getSnapshot);
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const layoutState = useSyncExternalStore(layout.subscribe, layout.getSnapshot);
  const viewState = useSyncExternalStore(viewports.subscribe, viewports.getSnapshot);
  useSyncExternalStore(media.subscribe, media.getSnapshot);
  const [sceneId, setSceneId] = useState('');
  const [selectedKey, setSelectedKey] = useState(state.selectedId ? `r:${state.selectedId}` : '');
  const [panel, setPanel] = useState<'detail' | 'tasks' | 'order' | ''>(state.dirty ? 'detail' : '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [sourceId, setSourceId] = useState(''), [role, setRole] = useState('参考');
  const [reuseId, setReuseId] = useState('');
  const lock = useRef(false), input = useRef<HTMLInputElement>(null), board = useRef<HTMLDivElement>(null);
  const scenes = catalog.records.filter(r => r.kind === 'scene');
  const activeScene = sceneId || state.base?.sceneId || scenes[0]?.id || '';
  const scene = scenes.find(s => s.id === activeScene);
  const shots = orderedShots(scene, catalog.records);
  const graph = buildGraph(catalog.records, activeScene);
  const selected = graph.nodes.find(n => n.id === selectedKey);
  const source = graph.nodes.find(n => n.id === sourceId);
  const sceneLayout = Object.hasOwn(layoutState.data.scenes, activeScene) ? layoutState.data.scenes[activeScene]! : defaultScene();
  const viewport = Object.hasOwn(viewState, activeScene) ? viewState[activeScene]! : sceneLayout.viewport;
  const position = (node: BoardNode, index = graph.nodes.indexOf(node)) => Object.hasOwn(sceneLayout.positions, node.positionId) ? sceneLayout.positions[node.positionId]! : { x: index % 4 * 320, y: Math.floor(index / 4) * 310 };
  const changeViewport = (v: typeof viewport) => { viewports.update(activeScene, v); layout.update(activeScene, v); };
  useEffect(() => {
    if (!activeScene || layoutState.status === 'loading' || layoutState.status === 'error') return;
    if (!Object.hasOwn(viewState, activeScene)) viewports.update(activeScene, sceneLayout.viewport);
    let index = Object.keys(sceneLayout.positions).length;
    graph.nodes.forEach(n => { if (!Object.hasOwn(sceneLayout.positions, n.positionId)) { layout.update(activeScene, { x: index % 4 * 320, y: Math.floor(index / 4) * 310 }, n.positionId); index++; } });
  }, [activeScene, graph.nodes.map(n => n.id).join('|'), layoutState.status]);
  useEffect(() => { if (state.selectedId) { setSelectedKey(`r:${state.selectedId}`); if (state.dirty) setPanel('detail'); } }, [state.selectedId]);
  async function run(action: () => Promise<void> | void, save = true) {
    if (lock.current || editor.getSnapshot().saving) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (save && editor.getSnapshot().dirty) { await editor.save(); if (editor.getSnapshot().dirty) { setPanel('detail'); throw new Error('当前编辑未能保存，请在详情中处理后再切换。'); } }
      if (save) await extractions.flushDrafts();
      await action();
    } catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  function focus(node: BoardNode) {
    const p = position(node), rect = board.current?.getBoundingClientRect();
    changeViewport({ x: Math.max(24, ((rect?.width ?? 900) - 380) / 2 - 130) - p.x, y: 70 - p.y, k: 1 });
  }
  function select(node: BoardNode, locate = false) {
    void run(async () => {
      if (source) { await connect(source, node); return; }
      if (node.record) editor.select(node.record.id); else editor.clearSelection();
      setSelectedKey(node.id); setPanel('detail'); if (locate) focus(node);
    });
  }
  function startConnect(node: BoardNode) { void run(() => { setSourceId(node.id); setPanel(''); setRole(node.reference && isVideoPath(node.reference.path) ? '视频候选' : ({ script: '剧情拆分', person: '人物参考', setting: '场景参考', frame: '起始帧' } as Record<string, string>)[node.record?.kind ?? ''] ?? '参考'); }); }
  async function connect(from: BoardNode, to: BoardNode) {
    if (from.id === to.id) throw new Error('请选择另一张卡片。');
    if (!to.record) throw new Error('请连接到剧本、人物、场景或镜头卡。');
    if (role === '拍摄资产') {
      if (!from.record || !isProductionAsset(from.record) || to.record.kind !== 'script') throw new Error('请从人物、场景或道具连接到剧本。');
    } else if (role !== '参考' && to.record.kind !== 'shot') throw new Error('这个用途需要连接到镜头卡；关联剧本请选择“拍摄资产”。');
    if (role === '视频候选') {
      if (!from.reference || !isVideoPath(from.reference.path)) throw new Error('视频候选关系需要从视频素材发起。');
      await media.attach(to.record.id, from.reference.path);
    } else {
      if (role === '起始帧' && (!from.reference || mediaKind(from.reference.path) !== 'image')) throw new Error('请先为起始帧卡关联一张图片，再连接到镜头。');
      const relation = role as CardLink['role'];
      await records.editLinks(to.record.id, links => links.some(l => l.from === from.id && l.role === relation) ? links : [...links, { id: crypto.randomUUID(), from: from.id, role: relation }]);
    }
    setSourceId('');
  }
  async function ensureScene() {
    if (scene) return scene.id;
    const created = await records.create('scene'); setSceneId(created.id); return created.id;
  }
  function place(sceneId: string, recordId: string, preferred?: { x: number; y: number }) {
    const positions = layout.getSnapshot().data.scenes[sceneId]?.positions ?? {};
    const start = preferred ?? { x: (70 - viewport.x) / viewport.k, y: (70 - viewport.y) / viewport.k };
    let index = 0, next = start;
    while (Object.entries(positions).some(([id, p]) => id !== recordId && Math.abs(p.x - next.x) < 280 && Math.abs(p.y - next.y) < 290)) {
      index++; next = { x: start.x + index % 3 * 320, y: start.y + Math.floor(index / 3) * 310 };
    }
    layout.update(sceneId, next, recordId);
  }
  async function create(kind: RecordKind) {
    await run(async () => {
      const id = kind === 'scene' ? undefined : await ensureScene();
      const r = await records.create(kind, id);
      if (kind === 'scene') { setSceneId(r.id); editor.clearSelection(); setSelectedKey(''); setPanel(''); }
      else {
        place(id!, r.id);
        editor.select(r.id); setSelectedKey(`r:${r.id}`); setPanel('detail');
      }
    });
  }
  async function importFiles(files: File[], point?: { x: number; y: number }) {
    await run(async () => {
      if (!files.length) return;
      for (const f of files) { if (!mediaKind(f.name)) throw new Error('请选择图片或视频；剧本文字请粘贴到剧本卡。'); if (f.size > 256 * 1024 * 1024) throw new Error('超过 256 MB 的素材请先放入资料库，再使用“关联库内素材”。'); }
      const id = await ensureScene();
      for (const [index, file] of files.entries()) {
        const r = await records.create('asset', id);
        await records.save(r, { ...draftOf(r), title: file.name });
        place(id, r.id, point ? { x: point.x + index * 290, y: point.y } : undefined);
        await media.importFile(r.id, file);
        editor.select(r.id); setSelectedKey(`r:${r.id}`);
      }
      setPanel('detail');
    });
  }
  function pickAsset() { media.pick(async file => { await run(async () => { const id = await ensureScene(), r = await records.create('asset', id); await records.save(r, { ...draftOf(r), title: file.basename }); await media.attach(r.id, file.path); place(id, r.id); editor.select(r.id); setSelectedKey(`r:${r.id}`); setPanel('detail'); }); }); }
  function removeEdge(edge: BoardEdge) { void run(async () => { if (edge.media) await media.remove(edge.target.id, edge.media.id); else if (edge.link) await records.editLinks(edge.target.id, links => links.filter(l => l.id !== edge.link!.id)); }); }
  function fit() {
    if (!graph.nodes.length) return;
    const rect = board.current!.getBoundingClientRect(), positions = graph.nodes.map(n => position(n));
    const x = Math.min(...positions.map(p => p.x)), y = Math.min(...positions.map(p => p.y));
    const w = Math.max(...positions.map(p => p.x + 260)) - x, h = Math.max(...positions.map(p => p.y + 270)) - y;
    const k = Math.max(.2, Math.min(1, (rect.width - 80) / w, (rect.height - 80) / h));
    changeViewport({ x: (rect.width - w * k) / 2 - x * k, y: 30 - y * k, k });
  }
  const related = graph.edges.filter(e => e.from === selectedKey || e.to === selectedKey);
  return <section className="obcanvas-workbench obcanvas-free" aria-label="影视画布工作台" onKeyDown={e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); void editor.save(); }
    if (e.key === 'Escape') { setSourceId(''); void run(() => setPanel('')); }
  }}>
    <header className="obcanvas-free-header"><strong>影视画布</strong><select aria-label="当前场次" value={activeScene} disabled={busy} onChange={e => { const id = e.target.value; void run(() => { setSceneId(id); editor.clearSelection(); setSelectedKey(''); setPanel(''); setSourceId(''); }); }}>
      {!scenes.length && <option value="">从剧本或素材开始</option>}{scenes.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
    </select><button disabled={busy} onClick={() => void create('scene')}>新建场次</button><button disabled={busy || !scene} onClick={() => void run(() => { editor.select(scene!.id); setSelectedKey(`r:${scene!.id}`); setPanel('detail'); })}>场次名称</button><span className="obcanvas-hint">本地资料库 · 0.4.0</span></header>
    <nav className="obcanvas-free-tools" aria-label="添加到画布">
      {(['script', 'person', 'setting', 'prop', 'shot', 'frame'] as const).map(kind => <button key={kind} disabled={busy || catalog.loading} onClick={() => void create(kind)}>＋ {kindLabels[kind]}</button>)}
      <button disabled={busy} onClick={() => input.current?.click()}>＋ 图片 / 视频</button><button disabled={busy} onClick={pickAsset}>关联库内素材</button>
      <input ref={input} className="obcanvas-file-input" aria-label="放入画布文件" type="file" multiple accept="image/*,video/*" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void importFiles(files); }} />
      <button onClick={() => void run(() => setPanel(panel === 'tasks' ? '' : 'tasks'))}>查看待办</button><button onClick={() => void run(() => setPanel(panel === 'order' ? '' : 'order'))}>镜头顺序</button>
    </nav>
    {(error || catalog.problems.length > 0) && <div className="obcanvas-alert" role="alert">{error}{catalog.problems.map(p => <p key={p}>{p}</p>)}<button onClick={() => { setError(''); void records.refresh(); }}>重新读取</button></div>}
    <div className="obcanvas-free-stage" ref={board} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); void importFiles(Array.from(e.dataTransfer.files), { x: (e.clientX - rect.left - viewport.x) / viewport.k, y: (e.clientY - rect.top - viewport.y) / viewport.k }); }}>
      <InfiniteCanvas key={activeScene} viewport={viewport} onViewportChange={changeViewport} onFit={fit} onBlankClick={() => void run(() => setPanel(''))}>
        <svg className="obcanvas-connections" aria-label="卡片用途连线">{graph.edges.map(edge => {
          const from = graph.nodes.find(n => n.id === edge.from), to = graph.nodes.find(n => n.id === edge.to); if (!from || !to) return null;
          const a = position(from), b = position(to), right = b.x >= a.x, x1 = a.x + (right ? 260 : 0), x2 = b.x + (right ? 0 : 260), y1 = a.y + 120, y2 = b.y + 120, d = Math.max(70, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
          return <g key={edge.id}><path d={`M${x1} ${y1} C${x1 + d} ${y1},${x2 - d} ${y2},${x2} ${y2}`} /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 10} textAnchor="middle">{edge.label} →</text></g>;
        })}</svg>
        {graph.nodes.map(n => <BoardCard key={`${n.id}:${n.reference ? media.previewKey(n.reference) : ''}`} node={n} media={media} position={position(n)} scale={viewport.k} selected={selectedKey === n.id} onSelect={() => select(n)} onMove={p => layout.update(activeScene, p, n.positionId)} onConnect={() => startConnect(n)} />)}
      </InfiniteCanvas>
      {!catalog.loading && !graph.nodes.length && <div className="obcanvas-start"><h1>把故事放上来。</h1><p>粘贴剧本，或直接拖入人物照片、场景图和视频。<br />放好之后，再连接它们的用途。</p><button className="mod-cta" disabled={busy} onClick={() => void create('script')}>＋ 放入剧本</button></div>}
      {panel && <aside className="obcanvas-inspector obcanvas-shot-card" aria-label={panel === 'detail' ? '卡片详情' : panel === 'tasks' ? '制作待办' : '镜头顺序'}>
        <div className="obcanvas-card-heading"><h2>{panel === 'detail' ? selected?.label ?? '场次' : panel === 'tasks' ? '下一步做什么' : '镜头顺序'}</h2><button aria-label="关闭详情" onClick={() => void run(() => setPanel(''))}>×</button></div>
        {panel === 'detail' && <>
          {selected?.record?.kind === 'script' && <>
            <ExtractionPanel script={selected.record} records={catalog.records} service={extractions} start={() => void run(() => { const id = selected.record!.id; void extractions.start(id, owner).catch(() => {}); })} apply={() => void run(async () => { const task = extractions.getSnapshot().tasks.find(t => t.scriptId === selected.record!.id); if (task) await extractions.apply(task); })} openAsset={id => { const node = graph.nodes.find(n => n.record?.id === id); if (node) select(node, true); else setError('资产已移除或无法读取，请检查项目记录。'); }} />
            <details><summary>关联已有拍摄资产（可跨场次复用）</summary><select aria-label="已有拍摄资产" value={reuseId} onChange={e => setReuseId(e.target.value)}><option value="">选择人物、场景或道具…</option>{catalog.records.filter(isProductionAsset).map(r => <option key={r.id} value={r.id}>{kindLabels[r.kind]} · {r.title}</option>)}</select><button disabled={busy || !reuseId} onClick={() => void run(async () => { await records.attachScriptAsset(await records.requireRecord(selected.record!.id), reuseId); setReuseId(''); })}>关联到剧本</button></details>
          </>}
          {selected?.record && isProductionAsset(selected.record) && <AssetPreparation key={selected.record.id} record={selected.record} records={records} media={media} />}
          {state.base && (selected?.record || state.base.kind === 'scene') ? <RecordInspector record={selected?.record ?? state.base} state={state} editor={editor} media={media} busy={busy} openNote={() => void run(() => openNote(state.base!.path))} /> : selected?.reference && <><h3>{selected.title}</h3><Preview key={media.previewKey(selected.reference)} media={media} reference={selected.reference} onReady={() => {}} onUnavailable={() => {}} /><p className="obcanvas-hint">采用和退回请在下方对应镜头中操作。</p></>}
          {selected && <><h3>这张卡与谁有关</h3>{related.length ? related.map(edge => { const other = graph.nodes.find(n => n.id === (edge.from === selectedKey ? edge.to : edge.from)); return <div className="obcanvas-relation" key={edge.id}><button disabled={!other || busy} onClick={() => { if (other) select(other, true); }}>{edge.label} · {other?.title ?? '来源在其他场次或已移除'}</button><button disabled={busy} onClick={() => removeEdge(edge)} aria-label={`移除${edge.label}关系`}>移除</button></div>; }) : <p className="obcanvas-hint">点击圆点，为这张卡连接用途。</p>}<button disabled={busy} onClick={() => startConnect(selected)}>＋ 连接到另一张卡</button></>}
        </>}
        {panel === 'tasks' && <><p className="obcanvas-hint">点击一项，直接找到对应资产或镜头。</p>{graph.nodes.filter(n => n.record && isProductionAsset(n.record) && assetStatus(n.record, r => media.referenceReady(r)) !== '已绑定参考图').map(n => <button className="obcanvas-task" key={n.id} onClick={() => select(n, true)}>{n.title}<span>{assetStatus(n.record!, r => media.referenceReady(r))}</span></button>)}{shots.filter(s => shotStatus(s) !== '已采用' || s.media?.some(m => media.locate(m).error)).map(s => <button className="obcanvas-task" key={s.id} onClick={() => select(graph.nodes.find(n => n.record?.id === s.id)!, true)}>{s.title}<span>{s.media?.some(m => media.locate(m).error) ? '素材缺失，请恢复文件' : shotStatus(s) === '待规划' ? '补充这个镜头的画面内容' : shotStatus(s) === '待素材' ? '准备参考图或放入生成结果' : shotStatus(s) === '待重做' ? '候选已退回，需要重新生成' : '比较候选，选择采用版本'}</span></button>)}{!shots.length && <p>可以先整理剧本和素材，再添加镜头。</p>}</>}
        {panel === 'order' && <nav className="obcanvas-order"><p className="obcanvas-hint">这里决定成片顺序；自由拖动卡片不影响顺序。</p>{shots.map((s, i) => <div data-order-shot={s.id} key={s.id}><button onClick={() => select(graph.nodes.find(n => n.record?.id === s.id)!, true)}>{String(i + 1).padStart(2, '0')} · {s.title}</button><span data-shot-status={shotStatus(s)}>{shotStatus(s)}</span><button aria-label={`上移镜头：${s.title}`} disabled={busy || i === 0} onClick={() => void run(() => records.moveShot(scene!, s.id, -1))}>上移</button><button aria-label={`下移镜头：${s.title}`} disabled={busy || i === shots.length - 1} onClick={() => void run(() => records.moveShot(scene!, s.id, 1))}>下移</button></div>)}</nav>}
      </aside>}
      {source && <div className="obcanvas-connect-bar" data-canvas-no-zoom><span>从「{source.title}」连接，点击目标卡片</span><select aria-label="连接用途" value={role} onChange={e => setRole(e.target.value)}>{[...linkRoles, '视频候选'].map(r => <option key={r}>{r}</option>)}</select><button onClick={() => setSourceId('')}>取消连接</button></div>}
    </div>
    <div className="obcanvas-free-status" role="status"><span>{busy ? '正在保存…' : '拖动卡片整理 · 拖动空白处平移 · 滚轮缩放 · 点击圆点连接'}</span><span data-layout-status={layoutState.status}>{layoutState.status === 'saved' ? '布局已保存' : layoutState.status === 'pending' ? '正在保存布局…' : layoutState.message}</span>{layoutState.status === 'error' && <button onClick={() => void layout.flush().then(() => layout.refresh()).catch(() => {})}>重试保存布局</button>}</div>
  </section>;
}

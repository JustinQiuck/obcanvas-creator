import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { filmProjects, projectOf, projectRecords, isProductionAsset, isVideoPath, kindLabels, assetStatus, type FilmRecord, type RecordKind } from '../model';
import { librarySections, type LibraryNavigation, type LibrarySection } from '../library-navigation';
import { errorMessage, type ProjectDeletion } from '../storage/vault-records';
import { DeleteProjectDialog } from './delete-project-dialog';
import { Workbench } from './workbench';
import { RecordInspector } from './record-inspector';
import { AssetPreparation } from './asset-preparation';
import { ExtractionPanel } from './extraction-panel';
import { StoryboardPanel } from './storyboard-panel';
import { DeleteCardDialog } from './delete-card-dialog';

type Props = Omit<ComponentProps<typeof Workbench>, 'projectId' | 'openSection'> & { navigation: LibraryNavigation };
export function LibraryWorkspace(props: Props) {
  const { records, editor, skills, extractions, storyboards, media, navigation, owner, openNote } = props;
  const catalog = useSyncExternalStore(records.subscribe, records.getSnapshot);
  const edit = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const location = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
  const extraction = useSyncExternalStore(extractions.subscribe, extractions.getSnapshot);
  const storyboard = useSyncExternalStore(storyboards.subscribe, storyboards.getSnapshot);
  useSyncExternalStore(media.subscribe, media.getSnapshot);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'), [assetMode, setAssetMode] = useState<'browse' | 'extract'>('browse');
  const [projectName, setProjectName] = useState(''), [renaming, setRenaming] = useState(false);
  const [nameRequired, setNameRequired] = useState(false);
  const projectNameInput = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<FilmRecord | null>(null);
  const [deletingProject, setDeletingProject] = useState<ProjectDeletion | null>(null);
  const lock = useRef(false), upload = useRef<HTMLInputElement>(null);
  const projects = filmProjects(catalog.records), project = projects.find(p => p.id === location.projectId);
  const local = project ? projectRecords(catalog.records, project.id) : [];
  const scripts = local.filter(r => r.kind === 'script'), assets = local.filter(isProductionAsset);
  const script = scripts.find(r => r.id === location.scriptId) ?? scripts[0];
  const selected = local.find(r => r.id === edit.selectedId);
  const aiBusy = extraction.busy || storyboard.busy, disabled = busy || edit.saving;
  // A recovery draft keeps its project and editor visible even without prior navigation state.
  useEffect(() => {
    if (!catalog.loading && edit.dirty && edit.base && !location.projectId) navigation.update({ projectId: projectOf(edit.base, catalog.records), section: edit.base.kind === 'script' ? 'scripts' : isProductionAsset(edit.base) ? 'assets' : 'canvas', scriptId: edit.base.kind === 'script' ? edit.base.id : '' });
  }, [catalog.loading]);
  async function run(action: () => Promise<void> | void) {
    if (lock.current || editor.getSnapshot().saving) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (editor.getSnapshot().dirty) { await editor.save(); if (editor.getSnapshot().dirty) throw new Error('当前内容尚未保存，请先处理编辑区中的提示。'); }
      await extractions.flushDrafts(); await storyboards.flushDrafts();
      await action();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  function go(section: LibrarySection, scriptId = location.scriptId) {
    void run(() => { navigation.update({ section, scriptId }); setQuery(''); setFilter('all'); setAssetMode('browse'); if (section !== 'canvas') editor.clearSelection(); });
  }
  function enter(id: string) { void run(() => { navigation.update({ projectId: id, section: 'scripts', scriptId: '' }); editor.clearSelection(); setQuery(''); setAssetMode('browse'); setRenaming(false); }); }
  function choose(record: FilmRecord) { void run(() => { editor.select(record.id); if (record.kind === 'script') navigation.update({ scriptId: record.id }); }); }
  async function create(kind: RecordKind) {
    await run(async () => {
      if (!project) return;
      let sceneId: string | undefined;
      if (kind === 'script') sceneId = (await records.create('scene', undefined, project.id, `场次 ${local.filter(r => r.kind === 'scene').length + 1}`)).id;
      const record = await records.create(kind, sceneId, project.id);
      editor.select(record.id); setQuery(''); setFilter('all');
      if (kind === 'script') navigation.update({ scriptId: record.id });
    });
  }
  const header = <header className="obcanvas-library-header">
    {project ? <><button disabled={disabled || aiBusy} onClick={() => void run(() => { navigation.update({ projectId: '' }); editor.clearSelection(); setProjectName(''); })}>← 剧本项目库</button><div><h1>{project.title}</h1><p>这个项目的剧本、人物、场景、道具和制作结果，都在这里。</p></div><button disabled={disabled} onClick={() => { setProjectName(project.title); setRenaming(!renaming); }}>修改项目名称</button></> : <div><h1>剧本项目库</h1><p>一部影片，一个项目。进入项目后统一管理剧本和全部拍摄资产。</p></div>}
    {project && <button disabled={disabled || aiBusy} onClick={() => void run(async () => setDeletingProject(await records.prepareProjectDeletion(project.id)))}>删除项目</button>}
    <small>本地资料库 · 0.7.2</small>
  </header>;
  const problem = (error || catalog.problems.length > 0) && <div role="alert" className="obcanvas-alert">{error}{catalog.problems.map(p => <p key={p}>{p}</p>)}<button onClick={() => { setError(''); void records.refresh(); }}>重新读取</button></div>;
  const projectDialog = deletingProject && <DeleteProjectDialog plan={deletingProject} busy={busy} error={error} cancel={() => { setDeletingProject(null); setError(''); }} confirm={() => void run(async () => { if (extractions.getSnapshot().busy || storyboards.getSnapshot().busy) throw new Error('请先等待 AI 任务结束或取消。'); await records.trashProject(deletingProject); editor.clearSelection(); setDeletingProject(null); navigation.update({ projectId: '', section: 'scripts', scriptId: '' }); setProjectName(''); })} />;
  if (!project) return <section className="obcanvas-library" aria-label="剧本项目库" aria-busy={disabled}>{header}{problem}
    {location.projectId && <p role="alert">原项目暂时无法读取，请恢复项目笔记，或选择下方项目。</p>}
    <div className="obcanvas-library-home"><form className="obcanvas-new-project" onSubmit={e => { e.preventDefault(); if (!projectName.trim()) { setNameRequired(true); projectNameInput.current?.focus(); return; } setNameRequired(false); void run(async () => { const p = await records.create('project', undefined, undefined, projectName); setProjectName(''); navigation.update({ projectId: p.id, section: 'scripts', scriptId: '' }); }); }}>
      <label>项目名称<input ref={projectNameInput} aria-label="新剧本项目名称" aria-invalid={nameRequired} value={projectName} maxLength={250} placeholder="输入影片名称，例如：夏日音乐 MV" onChange={e => { setProjectName(e.target.value); setNameRequired(false); }} /></label><button type="submit" className="mod-cta" disabled={disabled || catalog.loading || aiBusy}>{busy ? '正在创建…' : '新建剧本项目'}</button>
      <p className="obcanvas-new-project-hint" role={nameRequired ? 'alert' : undefined}>{nameRequired ? '请先填写项目名称，再点击新建。' : '先填写项目名称，再点击新建；创建后即可添加剧本和拍摄资产。'}</p>
    </form><div className="obcanvas-project-grid">{projects.map(p => { const list = projectRecords(catalog.records, p.id); return <button key={p.id} className="obcanvas-project-card" disabled={disabled || aiBusy} data-project-id={p.id} onClick={() => enter(p.id)}><strong>{p.title}</strong><span>{list.filter(r => r.kind === 'script').length} 份剧本 · {list.filter(isProductionAsset).length} 项拍摄资产 · {list.filter(r => r.kind === 'shot').length} 个镜头</span><small>进入项目 →</small></button>; })}</div>
    {!catalog.loading && !projects.length && <p>先为你的影片建立一个剧本项目，再放入剧本。</p>}
    </div>{projectDialog}</section>;
  const inspector = selected && <div className="obcanvas-library-editor" key={selected.id} data-library-record={selected.id}>
    <div className="obcanvas-card-heading"><h2>{kindLabels[selected.kind]} · {selected.title}</h2><button disabled={disabled || aiBusy} onClick={() => void run(async () => setDeleting(await records.requireRecord(selected.id)))}>删除卡片</button></div>
    {isProductionAsset(selected) && <><AssetPreparation key={selected.id} record={selected} records={records} media={media} /><section className="obcanvas-asset-usage"><h3>用于哪些剧本</h3><p>同一资产可用于本项目的多份剧本，描述和参考图共用。</p>{scripts.map(s => { const linked = s.links?.some(l => l.role === '拍摄资产' && l.from === `r:${selected.id}`); return <label key={s.id}><input type="checkbox" aria-label={`用于剧本：${s.title}`} checked={!!linked} disabled={disabled || aiBusy} onChange={() => void run(async () => { if (linked) await records.editLinks(s.id, links => links.filter(l => !(l.role === '拍摄资产' && l.from === `r:${selected.id}`))); else await records.attachScriptAsset(await records.requireRecord(s.id), selected.id); })} />{s.title}</label>; })}{!scripts.length && <p>添加剧本后可在这里关联用途。</p>}</section></>}
    <RecordInspector record={selected} state={edit} editor={editor} media={media} busy={busy} openNote={() => void run(() => openNote(selected.path))} />
    {selected.kind === 'script' && <div className="obcanvas-script-destinations"><p>本剧本关联 {selected.links?.filter(l => l.role === '拍摄资产').length ?? 0} 项拍摄资产。</p><button disabled={disabled} onClick={() => go('assets', selected.id)}>去资产库整理和绑定</button><button disabled={disabled} onClick={() => go('storyboard', selected.id)}>去分镜工作区</button></div>}
  </div>;
  const chooseScript = <label className="obcanvas-source-script">使用剧本<select aria-label="工作区使用剧本" value={script?.id ?? ''} disabled={disabled || aiBusy} onChange={e => { const id = e.target.value; void run(() => navigation.update({ scriptId: id })); }}>{!scripts.length && <option value="">请先添加剧本</option>}{scripts.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>;
  const empty = <div className="obcanvas-workspace-empty"><h2>{location.section === 'scripts' ? '把剧本放进这个项目' : '选择一项查看和编辑'}</h2><p>{location.section === 'scripts' ? '每份剧本可以是一场戏或一段剧情。人物与素材在资产库中统一管理。' : '这里汇总整个项目的内容，切换场次也不会丢失。'}</p></div>;
  let list = location.section === 'scripts' ? scripts : location.section === 'assets' ? assets : local.filter(r => r.kind === 'asset' || r.kind === 'frame' || r.media?.length);
  if (location.section === 'assets' && filter !== 'all') list = list.filter(r => r.kind === filter);
  list = list.filter(r => !query.trim() || r.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="obcanvas-library" aria-label="剧本项目工作台" aria-busy={disabled}>{header}
    {renaming && <form className="obcanvas-project-rename" onSubmit={e => { e.preventDefault(); void run(async () => { await records.nameProject(project, projectName); setRenaming(false); }); }}><input aria-label="剧本项目名称" value={projectName} maxLength={250} onChange={e => setProjectName(e.target.value)} /><button disabled={disabled || !projectName.trim()}>保存项目名称</button><button type="button" onClick={() => setRenaming(false)}>取消</button></form>}
    <nav aria-label="项目工作区" className="obcanvas-project-tabs">{Object.entries(librarySections).map(([key, label]) => <button key={key} aria-current={location.section === key ? 'page' : undefined} disabled={disabled} onClick={() => go(key as LibrarySection)}>{label}{key === 'assets' && <span>{assets.length}</span>}{key === 'scripts' && <span>{scripts.length}</span>}</button>)}</nav>
    {problem}
    {aiBusy && <p className="obcanvas-job-status" role="status">{extraction.busy ? '正在整理拍摄资产' : '正在处理分镜预览'} · {scripts.find(s => s.id === (extraction.busy ? extraction.scriptId : storyboard.scriptId))?.title ?? '正在保存'}<button onClick={() => void run(() => { navigation.update({ section: extraction.busy ? 'assets' : 'storyboard', scriptId: extraction.busy ? extraction.scriptId : storyboard.scriptId }); setAssetMode('extract'); editor.clearSelection(); })}>查看任务</button></p>}
    {location.section === 'canvas' ? <Workbench {...props} key={project.id} projectId={project.id} openSection={go} /> : <>
      <div className="obcanvas-workspace-toolbar"><h2>{librarySections[location.section]}</h2>
        {location.section === 'scripts' && <button className="mod-cta" disabled={disabled} onClick={() => void create('script')}>＋ 添加剧本</button>}
        {location.section === 'assets' && <><div role="group" aria-label="资产库操作"><button aria-pressed={assetMode === 'browse'} onClick={() => void run(() => setAssetMode('browse'))}>全部资产</button><button aria-pressed={assetMode === 'extract'} onClick={() => void run(() => { setAssetMode('extract'); editor.clearSelection(); })}>从剧本整理资产</button></div>{assetMode === 'browse' && (['person', 'setting', 'prop'] as const).map(kind => <button key={kind} disabled={disabled} onClick={() => void create(kind)}>＋ {kindLabels[kind]}</button>)}</>}
        {(location.section === 'storyboard' || location.section === 'assets' && assetMode === 'extract') && chooseScript}
        {location.section === 'media' && <><button disabled={disabled} onClick={() => upload.current?.click()}>导入图片 / 视频</button><input className="obcanvas-file-input" ref={upload} type="file" multiple accept="image/*,video/*" aria-label="导入项目素材" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void run(async () => { for (const file of files) { if (!/\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|m4v|ogv)$/i.test(file.name) || file.size > 256 * 1024 * 1024) throw new Error('请选择 256 MB 内的图片或视频。'); } for (const file of files) { const r = await records.create('asset', undefined, project.id, file.name); await media.importFile(r.id, file); editor.select(r.id); } }); }} /></>}
      </div>
      {location.section === 'storyboard' || location.section === 'assets' && assetMode === 'extract' ? <main className="obcanvas-task-workspace">
        {!script ? <p>项目中还没有剧本。<button onClick={() => go('scripts')}>去添加剧本</button></p> : location.section === 'storyboard' ? <StoryboardPanel key={script.id} script={script} records={local} service={storyboards} blocked={extraction.busy} start={() => void run(() => { void storyboards.start(script.id, owner).catch(() => {}); })} /> : <ExtractionPanel key={script.id} skills={skills} script={script} records={local} service={extractions} blocked={storyboard.busy} start={() => void run(() => { void extractions.start(script.id, owner, skills.resolve(script.id, project.id)).catch(() => {}); })} apply={() => void run(async () => { const task = extractions.getSnapshot().tasks.find(t => t.scriptId === script.id); if (task) await extractions.apply(task); })} openAsset={id => { const asset = local.find(r => r.id === id); if (asset) void run(() => { setAssetMode('browse'); setQuery(''); setFilter('all'); editor.select(id); }); }} />}
      </main> : <div className="obcanvas-library-split"><aside className="obcanvas-library-list" aria-label="项目内容列表">
        <input aria-label="搜索项目内容" placeholder="搜索名称…" value={query} onChange={e => setQuery(e.target.value)} />
        {location.section === 'assets' && <div className="obcanvas-asset-filters" role="group" aria-label="资产分类">{[['all', '全部'], ['person', '人物'], ['setting', '场景'], ['prop', '道具']].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id!)}>{label} {id === 'all' ? assets.length : assets.filter(a => a.kind === id).length}</button>)}</div>}
        {list.map(r => { const ref = r.media?.[0], preview = ref ? media.locate(ref) : undefined; return <button className="obcanvas-library-row" key={r.id} data-library-id={r.id} aria-pressed={selected?.id === r.id} disabled={disabled} onClick={() => choose(r)}>{preview?.kind === 'image' ? <img src={preview.url} alt="" /> : <span className="obcanvas-library-kind">{ref && isVideoPath(ref.path) ? '视频' : kindLabels[r.kind]}</span>}<span><strong>{r.title}</strong><small>{isProductionAsset(r) ? assetStatus(r, m => media.referenceReady(m)) : r.kind === 'script' ? `${r.body.trim().length} 字` : `${r.media?.length ?? 0} 份关联素材`}</small></span></button>; })}
        {!list.length && <p>这里还没有{location.section === 'scripts' ? '剧本' : location.section === 'assets' ? '匹配的资产' : '图片或视频'}。</p>}
      </aside><main className="obcanvas-library-detail">{selected && list.some(r => r.id === selected.id) ? inspector : empty}</main></div>}
    </>}
    {deleting && <DeleteCardDialog node={{ id: `r:${deleting.id}`, positionId: deleting.id, title: deleting.title, label: kindLabels[deleting.kind], body: deleting.body, record: deleting }} records={local} busy={busy} error={error} cancel={() => setDeleting(null)} confirm={() => void run(async () => { if (aiBusy) throw new Error('请先等待 AI 任务结束或取消。'); await records.trashCard(deleting); editor.clearSelection(); setDeleting(null); })} />}
    {projectDialog}
  </section>;
}

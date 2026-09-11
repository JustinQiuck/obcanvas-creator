import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isVideoPath, type FilmRecord, type MediaRef } from '../model';
import { VaultMedia } from '../storage/vault-media';
import { errorMessage } from '../storage/vault-records';
export function MediaPanel({ shot, media }: { shot: FilmRecord; media: VaultMedia }) {
  useSyncExternalStore(media.subscribe, media.getSnapshot);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const input = useRef<HTMLInputElement>(null);
  async function importFiles(files: File[]) { await run(async () => { for (const file of files) await media.importFile(shot.id, file); }); }
  return <section className="obcanvas-media-panel" aria-label="镜头素材" onDragOver={e => { e.preventDefault(); e.stopPropagation(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); if (!busy) void importFiles(Array.from(e.dataTransfer.files)); }}>
    <div className="obcanvas-card-heading"><h2>参考图与视频候选</h2><button disabled={busy} onClick={() => media.pick(file => run(() => media.attach(shot.id, file.path)))}>关联库内素材</button></div>
    <input ref={input} className="obcanvas-file-input" type="file" multiple aria-label="复制文件到资料库" accept=".png,.jpg,.jpeg,.webp,.gif,.avif,.mp4,.webm,.mov,.m4v,.ogv" onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; void importFiles(files); }} />
    <button disabled={busy} onClick={() => input.current?.click()}>复制文件到资料库</button>
    <p className="obcanvas-hint">可将文件拖到这里，复制并归入当前镜头，原文件保留。视频先作为候选；采用时会保留其他版本。</p>
    {busy && <p role="status">正在保存素材记录…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="obcanvas-media-grid">{(shot.media ?? []).map(ref => <Candidate key={ref.id} shot={shot} reference={ref} media={media} busy={busy} run={run} />)}</div>
    {!shot.media?.length && <p>这个镜头还没有关联素材。</p>}
  </section>;
}
function Candidate({ shot, reference: ref, media, busy, run }: { shot: FilmRecord; reference: MediaRef; media: VaultMedia; busy: boolean; run: (action: () => Promise<void>) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [readyKey, setReadyKey] = useState('');
  const key = media.previewKey(ref);
  const video = isVideoPath(ref.path);
  const decision = ref.decision ?? 'candidate';
  return <figure data-media-id={ref.id} data-decision={decision}>
    <Preview key={key} media={media} reference={ref} onReady={() => setReadyKey(key)} onUnavailable={() => setReadyKey('')} />
    <figcaption>{ref.path}</figcaption>
    {video && shot.kind === 'shot' && <><span className="obcanvas-decision">{decision === 'adopted' ? '已采用' : decision === 'rejected' ? '已退回' : '视频候选'}</span>
      {ref.reason && <p className="obcanvas-hint">退回原因：{ref.reason}</p>}
      <div className="obcanvas-media-actions">
        {decision !== 'adopted' && <button disabled={busy || readyKey !== key} onClick={() => void run(() => media.decide(shot, ref.id, 'adopted'))}>采用此视频</button>}
        {decision !== 'candidate' && <button disabled={busy} onClick={() => void run(() => media.decide(shot, ref.id, 'candidate'))}>{decision === 'adopted' ? '取消采用' : '恢复候选'}</button>}
      </div>
      <label className="obcanvas-reason">退回原因<input type="text" aria-label="退回原因" value={reason} placeholder="例如：动作不连贯，需要重做" onChange={e => setReason(e.target.value)} disabled={busy} /></label>
      <button disabled={busy || !reason.trim()} onClick={() => void run(() => media.decide(shot, ref.id, 'rejected', reason))}>退回重做</button>
    </>}
    <div className="obcanvas-media-actions"><button disabled={busy || decision === 'adopted'} title="更新所有使用这份素材的镜头；已采用视频需先取消采用" onClick={() => media.pick(file => run(() => media.relink(ref, file.path)))}>重新关联</button><button disabled={busy || decision === 'adopted'} onClick={() => void run(() => media.remove(shot.id, ref.id))}>移除关联</button></div>
  </figure>;
}

export function Preview({ media, reference, onReady, onUnavailable }: { media: VaultMedia; reference: MediaRef; onReady: () => void; onUnavailable: () => void }) {
  const source = media.locate(reference);
  const [error, setError] = useState('');
  const [metadata, setMetadata] = useState('尺寸与时长：未知');
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { const element = video.current; return () => { if (element) { element.pause(); element.removeAttribute('src'); element.load(); } }; }, []);
  if (source.error || error) return <p className="obcanvas-media-error" role="alert">{source.error || error}</p>;
  return <>{source.kind === 'image' ? <img src={source.url} alt={source.name} loading="lazy" onLoad={e => { setMetadata(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`); onReady(); }} onError={() => { onUnavailable(); setError('图片无法解析，请检查文件或重新关联。'); }} /> : <video ref={video} src={source.url} controls preload="metadata" playsInline onLoadedData={onReady} onLoadedMetadata={e => { const v = e.currentTarget; setMetadata(`${v.videoWidth} × ${v.videoHeight} · ${Number.isFinite(v.duration) ? v.duration.toFixed(1) + ' 秒' : '时长未知'}`); }} onError={() => { onUnavailable(); setError('视频无法播放，文件可能损坏或编码不受支持，请重新关联。'); }} />}
    <span className="obcanvas-hint">{metadata}</span></>;
}

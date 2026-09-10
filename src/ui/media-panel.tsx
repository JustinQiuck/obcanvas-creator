import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FilmRecord, MediaRef } from '../model';
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
  return <section className="obcanvas-media-panel" aria-label="镜头素材">
    <div className="obcanvas-card-heading"><h2>参考图与视频</h2><button disabled={busy} onClick={() => media.pick(file => run(() => media.attach(shot.id, file.path)))}>关联库内素材</button></div>
    <p className="obcanvas-hint">先将文件放入资料库，再选择关联。关联只登记素材，采用决定将在选片阶段记录。</p>
    {error && <p role="alert">{error}</p>}
    <div className="obcanvas-media-grid">{(shot.media ?? []).map(ref => <figure key={ref.id} data-media-id={ref.id}>
      <Preview key={media.previewKey(ref)} media={media} reference={ref} />
      <figcaption>{ref.path}</figcaption>
      <div className="obcanvas-media-actions"><button disabled={busy} title="更新所有使用这份素材的镜头" onClick={() => media.pick(file => run(() => media.relink(ref, file.path)))}>重新关联</button><button disabled={busy} onClick={() => void run(() => media.remove(shot.id, ref.id))}>移除关联</button></div>
    </figure>)}</div>
    {!shot.media?.length && <p>这个镜头还没有关联素材。</p>}
  </section>;
}
function Preview({ media, reference }: { media: VaultMedia; reference: MediaRef }) {
  const source = media.locate(reference);
  const [error, setError] = useState('');
  const [metadata, setMetadata] = useState('尺寸与时长：未知');
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { const element = video.current; return () => { if (element) { element.pause(); element.removeAttribute('src'); element.load(); } }; }, []);
  if (source.error || error) return <p className="obcanvas-media-error" role="alert">{source.error || error}</p>;
  return <>{source.kind === 'image' ? <img src={source.url} alt={source.name} loading="lazy" onLoad={e => setMetadata(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} onError={() => setError('图片无法解析，请检查文件或重新关联。')} /> : <video ref={video} src={source.url} controls preload="metadata" playsInline onLoadedMetadata={e => { const v = e.currentTarget; setMetadata(`${v.videoWidth} × ${v.videoHeight} · ${Number.isFinite(v.duration) ? v.duration.toFixed(1) + ' 秒' : '时长未知'}`); }} onError={() => setError('视频无法播放，文件可能损坏或编码不受支持，请重新关联。')} />}
    <span className="obcanvas-hint">{metadata}</span></>;
}

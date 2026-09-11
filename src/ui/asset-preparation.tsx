import { useState } from 'react';
import { assetDetails, assetStatus, type FilmRecord } from '../model';
import type { VaultRecords } from '../storage/vault-records';
import type { VaultMedia } from '../storage/vault-media';
export function AssetPreparation({ record, records, media }: { record: FilmRecord; records: VaultRecords; media: VaultMedia }) {
  const details = assetDetails(record);
  const [purpose, setPurpose] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function save(next: typeof details) {
    setBusy(true); setError(''); try { await records.updateAssetDetails(record, next); setPurpose(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="obcanvas-asset-preparation" aria-label="资产准备状态"><h3>{assetStatus(record, r => media.referenceReady(r))}</h3>
    {!!details.unresolved.length && <><p>先在卡片内容中补充确定的信息，再逐项确认：</p>{details.unresolved.map((s, i) => <div className="obcanvas-relation" key={i}><span>{s}</span><button disabled={busy} onClick={() => void save({ ...details, unresolved: details.unresolved.filter((_, n) => n !== i) })}>已确认此项</button></div>)}</>}
    <p>需要准备的参考用途：</p>{details.needs.map(p => <div className="obcanvas-relation" key={p}><span>{p}</span><button disabled={busy || details.needs.length === 1} onClick={() => void save({ ...details, needs: details.needs.filter(n => n !== p) })}>不再需要</button></div>)}
    <label>补充参考用途<input aria-label="补充参考用途" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="例如：平面图、背面、妆造" /></label><button disabled={busy || !purpose.trim()} onClick={() => void save({ ...details, needs: [...new Set([...details.needs, purpose.trim()])] })}>添加用途</button>
    {error && <p role="alert">{error}</p>}
  </section>;
}

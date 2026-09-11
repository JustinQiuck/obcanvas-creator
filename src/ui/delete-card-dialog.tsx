import { useEffect, useRef } from 'react';
import type { BoardNode } from '../canvas/graph';
import type { FilmRecord } from '../model';

export function DeleteCardDialog({ node, records, busy, error, cancel, confirm }: { node: BoardNode; records: FilmRecord[]; busy: boolean; error: string; cancel: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const linked = records.filter(r => r.id !== node.record?.id && r.links?.some(l => l.from === node.id));
  return <dialog ref={dialog} className="obcanvas-delete-dialog" aria-label="确认删除卡片" onKeyDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); if (!busy) cancel(); }}>
    <h2>{node.record ? '删除卡片' : '移除素材卡'}「{node.title}」？</h2>
    {node.record ? <>
      <p>对应笔记将移入此资料库的回收站（.trash）。图片、视频文件和其他卡片保留。</p>
      {!!linked.length && <p>有 {linked.length} 张卡片引用它，包括其他场次中的引用。删除后这些引用暂不可用；将笔记从回收站放回原处可恢复。</p>}
      {!!node.record.media?.length && <p>若素材还被其他卡片使用，它仍会作为参考素材显示。</p>}
    </> : <p>移除这份素材在当前场次的关联，其他场次与源文件保留。已采用的视频需先在镜头中取消采用。</p>}
    {error && <p role="alert">{error}</p>}
    <div className="obcanvas-delete-actions"><button autoFocus disabled={busy} onClick={cancel}>取消</button><button className="mod-warning" disabled={busy} onClick={confirm}>{busy ? '正在处理…' : node.record ? '移入回收站' : '确认移除素材卡'}</button></div>
  </dialog>;
}

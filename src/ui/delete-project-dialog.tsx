import { useEffect, useRef } from 'react';
import { isProductionAsset } from '../model';
import type { ProjectDeletion } from '../storage/vault-records';

export function DeleteProjectDialog({ plan, busy, error, cancel, confirm }: { plan: ProjectDeletion; busy: boolean; error: string; cancel: () => void; confirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="obcanvas-delete-dialog" aria-label="确认删除剧本项目" onKeyDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); if (!busy) cancel(); }}>
    <h2>删除项目「{plan.project.title}」？</h2>
    <p>将移入资料库回收站（.trash）：{plan.records.length + (plan.project.path ? 1 : 0)} 份笔记，包含项目内 {plan.records.filter(r => r.kind === 'script').length} 份剧本、{plan.records.filter(isProductionAsset).length} 项拍摄资产、{plan.records.filter(r => r.kind === 'shot').length} 个镜头及其他卡片。</p>
    <p>图片、视频源文件、AI 整理记录和画布布局保留。其他项目不会删除。恢复时，将本项目笔记从 .trash 放回原位置。</p>
    {error && <p role="alert">{error}</p>}
    <div className="obcanvas-delete-actions"><button autoFocus disabled={busy} onClick={cancel}>取消</button><button className="mod-warning" disabled={busy} onClick={confirm}>{busy ? '正在删除…' : '确认删除项目'}</button></div>
  </dialog>;
}

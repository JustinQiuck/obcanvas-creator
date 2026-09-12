import { type FilmRecord } from '../model';
import type { EditorSession, EditorState } from '../editor-session';
import type { VaultMedia } from '../storage/vault-media';
import { MediaPanel } from './media-panel';

export function RecordInspector({ record, state, editor, media, openNote, busy }: { record: FilmRecord; state: EditorState; editor: EditorSession; media: VaultMedia; openNote: () => void; busy: boolean }) {
  return <fieldset className="obcanvas-editor-fields" disabled={busy || state.saving}>
    <label>{record.kind === 'shot' ? '镜头标题' : '卡片标题'}<input aria-label={record.kind === 'shot' ? '镜头标题' : '卡片标题'} value={state.draft.title} onChange={e => editor.edit('title', e.target.value)} /></label>
    <label>{record.kind === 'script' ? '粘贴剧本' : '内容'}<textarea aria-label={record.kind === 'shot' ? '镜头内容' : '卡片内容'} rows={7} value={state.draft.body} onChange={e => editor.edit('body', e.target.value)} placeholder={record.kind === 'script' ? '把与 Grok 讨论好的剧本粘贴到这里。' : '写下这张卡片的内容或用途。'} /></label>
    {record.kind === 'shot' && <details><summary>镜头规划（理由、景别、机位）</summary>
      <label>拍摄理由<input aria-label="拍摄理由" value={state.draft.intent ?? ''} onChange={e => editor.edit('intent', e.target.value)} /></label>
      <label>景别<select aria-label="景别" value={state.draft.framing ?? ''} onChange={e => editor.edit('framing', e.target.value)}><option value="">待确定</option>{[...new Set(['远景', '全景', '中景', '近景', '特写', ...(state.draft.framing ? [state.draft.framing] : [])])].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>机位与运动<input aria-label="机位与运动" value={state.draft.camera ?? ''} onChange={e => editor.edit('camera', e.target.value)} /></label>
      <p className="obcanvas-hint">当前可记录或粘贴已有分镜分析，尚未接入 AI 拆镜。</p>
    </details>}
    {record.kind !== 'script' && <details><summary>提示词与来源（可选）</summary><label>原提示词<textarea aria-label="原提示词" rows={4} value={state.draft.prompt ?? ''} onChange={e => editor.edit('prompt', e.target.value)} /></label><label>来源备注<input aria-label="来源备注" value={state.draft.source ?? ''} onChange={e => editor.edit('source', e.target.value)} /></label></details>}
    {state.message && <p role={['error', 'conflict'].includes(state.status) ? 'alert' : 'status'}>{state.message}</p>}
    <footer><button className="mod-cta" disabled={!state.dirty} onClick={() => void editor.save()}>保存到笔记</button><button onClick={openNote}>打开对应笔记</button>{state.dirty && <button onClick={() => void editor.loadLatest()}>放弃本地修改，载入笔记</button>}</footer>
    <span data-save-status={state.saving ? 'saving' : state.status} role="status">{state.saving ? '保存中…' : state.dirty ? '尚未保存 · 切换卡片时保存，失败保留输入' : '已保存到资料库'}</span>
    {!['scene', 'script', 'project'].includes(record.kind) && <MediaPanel key={record.id} shot={record} media={media} /> }
  </fieldset>;
}

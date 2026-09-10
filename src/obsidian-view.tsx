import { ItemView, type WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import type ObCanvasPlugin from './main';
import { EditorSession } from './editor-session';
import { Workbench } from './ui/workbench';
export const VIEW_TYPE = 'obcanvas-film-view';
export class FilmView extends ItemView {
  private root: Root | null = null;
  editor!: EditorSession;
  private sessionId = '';
  private stopTracking?: () => void;
  constructor(leaf: WorkspaceLeaf, readonly plugin: ObCanvasPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '影视画布'; }
  getIcon() { return 'clapperboard'; }
  async onOpen() {
    this.contentEl.addClass('obcanvas-root');
    const session = this.plugin.claimSession();
    this.sessionId = session.id;
    this.editor = new EditorSession(this.plugin.records, session.recovery);
    this.stopTracking = this.editor.subscribe(() => {
      this.plugin.updateDraft(this.sessionId, this.editor.recovery());
      this.app.workspace.requestSaveLayout();
    });
    this.root = createRoot(this.contentEl);
    this.root.render(<Workbench records={this.plugin.records} editor={this.editor} openNote={async path => { await this.app.workspace.openLinkText(path, '', 'split'); }} />);
  }
  getState() { return { shotId: this.editor?.getSnapshot().selectedId }; }
  async setState(state: { shotId?: string }, result: ViewStateResult) {
    if (typeof state.shotId === 'string' && !this.editor.getSnapshot().dirty) this.editor.select(state.shotId);
    await super.setState(state, result);
  }
  async onClose() {
    this.plugin.updateDraft(this.sessionId, this.editor.recovery());
    this.stopTracking?.();
    this.root?.unmount(); this.root = null;
    this.editor.dispose();
    this.plugin.releaseSession(this.sessionId);
    await this.plugin.flushDrafts().catch(() => {});
  }
}

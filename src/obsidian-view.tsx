import { ItemView, type WorkspaceLeaf, type ViewStateResult } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import type ObCanvasPlugin from './main';
import { EditorSession } from './editor-session';
import { Workbench } from './ui/workbench';
import { Viewports } from './canvas/viewports';
export const VIEW_TYPE = 'obcanvas-film-view';
export class FilmView extends ItemView {
  private root: Root | null = null;
  editor!: EditorSession;
  viewports = new Viewports(() => this.app.workspace.requestSaveLayout());
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
    this.root.render(<Workbench skills={this.plugin.skills} records={this.plugin.records} layout={this.plugin.layout} viewports={this.viewports} media={this.plugin.media} editor={this.editor} extractions={this.plugin.extractions} owner={this.sessionId} openNote={async path => { await this.app.workspace.openLinkText(path, '', 'split'); }} />);
  }
  getState() { return { shotId: this.editor?.getSnapshot().selectedId, viewports: this.viewports.getSnapshot() }; }
  async setState(state: { shotId?: string; viewports?: unknown }, result: ViewStateResult) {
    if (typeof state.shotId === 'string' && !this.editor.getSnapshot().dirty) this.editor.select(state.shotId);
    this.viewports.restore(state.viewports);
    await super.setState(state, result);
  }
  async onClose() {
    this.plugin.extractions.cancel(this.sessionId);
    await this.plugin.extractions.flushDrafts().catch(() => {});
    this.plugin.updateDraft(this.sessionId, this.editor.recovery());
    this.stopTracking?.();
    this.root?.unmount(); this.root = null;
    this.editor.dispose();
    this.plugin.releaseSession(this.sessionId);
    await this.plugin.flushDrafts().catch(() => {});
    await this.plugin.layout.flush().catch(() => {});
  }
}

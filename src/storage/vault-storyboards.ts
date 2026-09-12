import type { TFile, Vault } from 'obsidian';
import { parseStoryboardTask, type StoryboardTask } from '../ai/storyboard-model';
import { taskIdValid } from '../ai/extraction-model';
import { PROJECT_ROOT } from './vault-records';

export const STORYBOARDS_ROOT = `${PROJECT_ROOT}/分镜设计`;
type Access = Pick<Vault, 'getFiles' | 'getAbstractFileByPath' | 'read' | 'process' | 'create' | 'createFolder'>;

export class VaultStoryboards {
  constructor(private vault: Access) {}
  async list() {
    const tasks: StoryboardTask[] = [];
    for (const file of this.vault.getFiles().filter(file => file.path.startsWith(STORYBOARDS_ROOT + '/') && file.extension === 'json')) tasks.push(parseStoryboardTask(await this.vault.read(file)));
    return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async save(task: StoryboardTask, base?: StoryboardTask) {
    if (!taskIdValid(task.id)) throw new Error('分镜任务编号无效。');
    const next = parseStoryboardTask(JSON.stringify({ ...task, revision: base ? base.revision + 1 : 0 }));
    const path = `${STORYBOARDS_ROOT}/${task.id}.json`;
    for (const folder of [PROJECT_ROOT, STORYBOARDS_ROOT]) if (!this.vault.getAbstractFileByPath(folder)) {
      try { await this.vault.createFolder(folder); } catch (error) { if (!this.vault.getAbstractFileByPath(folder)) throw error; }
    }
    if (base) {
      const file = this.vault.getAbstractFileByPath(path);
      if (!file || !('extension' in file)) throw new Error('分镜预览草稿已删除，未重建或覆盖。');
      await this.vault.process(file as TFile, raw => {
        const current = parseStoryboardTask(raw);
        if (JSON.stringify(current) !== JSON.stringify(base)) throw new Error('分镜预览草稿已被修改，请重新打开后重试。');
        return JSON.stringify(next, null, 2) + '\n';
      });
    } else await this.vault.create(path, JSON.stringify(next, null, 2) + '\n');
    return next;
  }
}

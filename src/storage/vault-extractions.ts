import type { TFile, Vault } from 'obsidian';
import { PROJECT_ROOT } from './vault-records';
import { parseTask, taskIdValid, type ExtractionTask } from '../ai/extraction-model';

export const EXTRACTIONS_ROOT = `${PROJECT_ROOT}/资产整理`;
type Access = Pick<Vault, 'getFiles' | 'getAbstractFileByPath' | 'read' | 'process' | 'create' | 'createFolder'>;
export class VaultExtractions {
  constructor(private vault: Access) {}
  async list() {
    const tasks: ExtractionTask[] = [];
    for (const file of this.vault.getFiles().filter(f => f.path.startsWith(EXTRACTIONS_ROOT + '/') && f.extension === 'json')) tasks.push(parseTask(await this.vault.read(file)));
    return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async save(task: ExtractionTask, base?: ExtractionTask) {
    if (!taskIdValid(task.id)) throw new Error('任务编号无效。');
    const next = parseTask(JSON.stringify({ ...task, revision: base ? base.revision + 1 : 0 }));
    const path = `${EXTRACTIONS_ROOT}/${task.id}.json`;
    for (const folder of [PROJECT_ROOT, EXTRACTIONS_ROOT]) if (!this.vault.getAbstractFileByPath(folder)) {
      try { await this.vault.createFolder(folder); } catch (e) { if (!this.vault.getAbstractFileByPath(folder)) throw e; }
    }
    if (base) {
      const file = this.vault.getAbstractFileByPath(path);
      if (!file || !('extension' in file)) throw new Error('整理草稿已删除，未重建或覆盖。');
      await this.vault.process(file as TFile, raw => {
        const current = parseTask(raw);
        if (JSON.stringify(current) !== JSON.stringify(base)) throw new Error('整理草稿已被修改，请重新打开清单后重试。');
        return JSON.stringify(next, null, 2) + '\n';
      });
    } else await this.vault.create(path, JSON.stringify(next, null, 2) + '\n');
    return next;
  }
}

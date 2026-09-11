import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, newRecord, parseRecord, patchMedia, decideMedia, patchRecord, patchOrder, orderedShots, shotStatus, draftOf } from '../src/model';
const create = () => patchMedia(newRecord('shot', 's', '测试镜头', 'scene') + '原始正文', 's', () => [{ id: 'v1', path: '视频/一.mp4' }, { id: 'v2', path: '视频/二.mp4' }, { id: 'img', path: '参考图.png' }]);
const parse = (raw: string) => parseRecord(raw, '影视项目/测试.md')!;
test('导入视频不等于采用；五种状态区分图片与视频', () => {
  const empty = parse(newRecord('shot', 's', '镜头', 'scene'));
  assert.equal(shotStatus(empty), '待规划');
  assert.equal(shotStatus({ ...empty, body: '固定镜头', media: [{ id: 'i', path: '图.png' }] }), '待素材');
  let raw = create(); assert.equal(shotStatus(parse(raw)), '待选片');
  raw = decideMedia(raw, parse(raw), 'v1', 'rejected', '画面变形');
  assert.equal(shotStatus(parse(raw)), '待选片');
  raw = decideMedia(raw, parse(raw), 'v2', 'rejected', '动作不连贯'); assert.equal(shotStatus(parse(raw)), '待重做');
  raw = decideMedia(raw, parse(raw), 'v2', 'adopted'); assert.equal(shotStatus(parse(raw)), '已采用');
});
test('采用第二版本保留第一版本并取消旧采用，退回记录原因', () => {
  let raw = create(); raw = decideMedia(raw, parse(raw), 'v1', 'adopted'); raw = decideMedia(raw, parse(raw), 'v2', 'adopted');
  assert.equal(parse(raw).media!.length, 3);
  assert.deepEqual(parse(raw).media!.map(m => m.decision), ['candidate', 'adopted', undefined]);
  raw = decideMedia(raw, parse(raw), 'v2', 'rejected', '  动作不符  ');
  assert.equal(parse(raw).media![1]!.reason, '动作不符');
  raw = decideMedia(raw, parse(raw), 'v2', 'candidate'); assert.equal(parse(raw).media![1]!.reason, undefined);
  assert.equal(parse(raw).body, '原始正文');
});
test('过期的选片表单拒绝覆盖并发决定、改名或移除的候选', () => {
  const raw = create(), base = parse(raw);
  const current = decideMedia(raw, base, 'v1', 'adopted');
  assert.throws(() => decideMedia(current, base, 'v2', 'adopted'), ConflictError);
  assert.throws(() => decideMedia(raw.replace('视频/一.mp4', '视频/改名.mp4'), base, 'v1', 'adopted'), ConflictError);
  assert.throws(() => decideMedia(patchMedia(raw, 's', items => items.slice(1)), base, 'v1', 'adopted'), ConflictError);
  assert.throws(() => decideMedia(raw, base, 'img', 'adopted'));
  assert.throws(() => decideMedia(raw, base, 'v1', 'rejected', ''));
});
test('未知属性和规划内容保留；不同规划字段合并，同字段冲突拒绝覆盖', () => {
  const raw = create().replace('obcanvas:', '# 原有注释\ncustom: 保留\nobcanvas:');
  const base = parse(raw);
  const planned = patchRecord(raw, base, { ...draftOf(base), intent: '表达距离', framing: '特写', camera: '固定', prompt: '原始提示词', source: '工作流备注' });
  const external = patchRecord(planned, parse(planned), { ...draftOf(parse(planned)), framing: '中景' });
  const merged = patchRecord(external, parse(planned), { ...draftOf(parse(planned)), intent: '表达犹豫' });
  assert.equal(parse(merged).framing, '中景'); assert.equal(parse(merged).intent, '表达犹豫');
  assert.throws(() => patchRecord(external, parse(planned), { ...draftOf(parse(planned)), framing: '远景' }), ConflictError);
  const chosen = decideMedia(merged, parse(merged), 'v1', 'adopted');
  assert.ok(chosen.includes('# 原有注释') && chosen.includes('custom: 保留')); assert.equal(parse(chosen).prompt, '原始提示词');
});
test('顺序存场次笔记，按稳定 ID 排序；新增或删除不串镜头', () => {
  const raw = newRecord('scene', 'scene', '测试场次') + '场次说明';
  const ordered = patchOrder(raw, 'scene', () => ['b', 'a']);
  const shots = ['a', 'b', 'c'].map(id => parse(newRecord('shot', id, id, 'scene')));
  assert.deepEqual(orderedShots(parse(ordered), shots).map(s => s.id), ['b', 'a', 'c']);
  assert.deepEqual(orderedShots(parse(ordered), shots.filter(s => s.id !== 'b')).map(s => s.id), ['a', 'c']);
  assert.equal(parse(ordered).body, '场次说明');
  assert.throws(() => patchOrder(raw, 'scene', () => ['a', 'a']));
  assert.throws(() => patchOrder(raw, 'wrong', () => []));
});
test('拒绝两个同时采用、未知决定及没有原因的退回记录', () => {
  const raw = create();
  for (const decision of ['adopted', 'unknown', 'rejected']) assert.throws(() => patchMedia(raw, 's', items => items.map(m => ({ ...m, decision: decision as 'adopted' }))));
});

test('排序保存读取最新场次，拒绝扫描后发生的并发顺序修改', async () => {
  const { VaultRecords } = await import('../src/storage/vault-records');
  const files = ['scene', 'a', 'b'].map(id => ({ path: `影视项目/${id}.md`, source: id === 'scene' ? patchOrder(newRecord('scene', 'scene', '场次'), 'scene', () => ['a', 'b']) : newRecord('shot', id, id, 'scene') }));
  const scene = files[0]!; const base = parse(scene.source);
  const vault = {
    getMarkdownFiles: () => files,
    read: async (file: typeof scene) => file.source,
    process: async (file: typeof scene, update: (raw: string) => string) => { file.source = patchOrder(file.source, 'scene', () => ['b', 'a']); file.source = update(file.source); return file.source; },
  };
  const records = new VaultRecords(vault as unknown as import('obsidian').Vault);
  await assert.rejects(records.moveShot(base, 'b', -1), ConflictError);
  assert.deepEqual(parse(scene.source).shotOrder, ['b', 'a']);
  records.dispose();
});

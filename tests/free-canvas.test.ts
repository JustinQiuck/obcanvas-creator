import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRecord, parseRecord, patchRecord, patchMedia, patchLinks, draftOf, isRecovery, decideMedia } from '../src/model';
import { buildGraph } from '../src/canvas/graph';

test('自由卡片沿用笔记保存与草稿格式，未知属性和正文在连线后保留', () => {
  for (const kind of ['script','person','setting','frame','asset'] as const) {
    const raw = newRecord(kind, kind, '测试', 'scene') + '原文\n';
    const r = parseRecord(raw, 'test.md')!;
    const linked = patchLinks(raw, kind, items => [...items, { id:'link', from:'r:source', role:'参考' }]);
    assert.equal(parseRecord(linked, '')!.body, '原文\n');
    const updated = patchRecord(linked, r, { ...draftOf(r), title:'改名' });
    assert.equal(parseRecord(updated, '')!.links?.[0]?.from, 'r:source');
    assert.ok(isRecovery({ base:r, draft:{...draftOf(r),body:'未保存'} }));
  }
});
test('旧镜头素材直接投影到画布，共享视频保留各镜头独立采用决定', () => {
  const media = { id:'video', path:'影视项目/素材/clip.mp4' };
  const make = (id:string) => patchMedia(newRecord('shot',id,id,'s'),id,()=>[media]);
  let a = make('a'), b = make('b');
  a=decideMedia(a,parseRecord(a,'a.md')!,'video','adopted');
  b=decideMedia(b,parseRecord(b,'b.md')!,'video','rejected','需重做');
  const records=[parseRecord(a,'a.md')!,parseRecord(b,'b.md')!];
  const graph=buildGraph(records,'s');
  assert.equal(graph.nodes.filter(n=>n.id==='m:video').length,1);
  assert.equal(graph.edges.length,2);
  assert.equal(graph.edges[0]!.media?.decision,'adopted');
  assert.equal(graph.edges[1]!.media?.decision,'rejected');
  assert.equal(graph.nodes.find(n=>n.id==='m:video')!.record,undefined);
});
test('素材被卡片持有后不重复显示，早期媒体引用仍能解析', () => {
  const ref={id:'image',path:'影视项目/图.png'};
  const asset=parseRecord(patchMedia(newRecord('frame','f','帧','s'),'f',()=>[ref]),'f.md')!;
  const shot=parseRecord(patchLinks(newRecord('shot','a','镜头','s'),'a',()=>[{id:'l',from:'m:image',role:'起始帧'}]),'a.md')!;
  const graph=buildGraph([asset,shot],'s');
  assert.equal(graph.nodes.length,2);assert.equal(graph.edges[0]!.from,'r:f');
  assert.equal(buildGraph([asset,shot],'other').nodes.length,0);
});
test('无效连线和无所属场次的卡片拒绝保存', () => {
  assert.throws(()=>parseRecord(newRecord('script','s','剧本'),''));
  assert.throws(()=>patchLinks(newRecord('shot','s','镜头','scene'),'s',()=>[{id:'l',from:'unknown',role:'参考'}]));
});

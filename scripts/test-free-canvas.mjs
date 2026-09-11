import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const browser=await chromium.connectOverCDP('http://127.0.0.1:19347');
const vault=resolve('.local/test-vault');const checks=[];
let page;
try {
 for(const p of browser.contexts().flatMap(c=>c.pages())) if(await p.evaluate(()=>globalThis.app?.vault?.adapter?.getBasePath?.()).catch(()=>null)===vault){page=p;break;}
 assert.ok(page,'仅操作隔离测试资料库');page.setDefaultTimeout(12000);
 await page.waitForFunction(()=>app.plugins.plugins['obcanvas-creator']?.ready);
 await page.evaluate(async()=>{await app.plugins.plugins['obcanvas-creator'].openView();});
 const root=page.locator('.obcanvas-free').first();
 await root.waitFor();
 async function check(name,fn){await fn();checks.push(name);console.log('通过：'+name);}
 const idle=()=>page.waitForFunction(()=>!document.querySelector('.obcanvas-free-tools button')?.disabled);
 const record=async id=>{await idle(); return page.evaluate(id=>app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r=>r.id===id),id);};
 const node=id=>root.locator(`[data-node-id="r:${id}"]`);
 const button=name=>root.getByRole('button',{name,exact:true});
 const current=async()=>{await idle(); return page.evaluate(()=>app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().selectedId);};
 async function choose(id){await button('总览').click();await node(id).click();await root.getByRole('complementary',{name:'卡片详情'}).waitFor();}
 async function close(){await button('关闭详情').click();await root.getByRole('complementary',{name:'卡片详情'}).waitFor({state:'hidden'});}
 if(process.argv.includes('--reopen')){
  const s=JSON.parse(await readFile('.local/r1-checkpoint.json','utf8'));
  await root.getByLabel('当前场次',{exact:true}).selectOption(s.scene);
  await check('完整重启后恢复剧本、素材、连线、采用记录和卡片位置',async()=>{
   for(const [id,before] of Object.entries(s.records))assert.deepEqual(await record(id),before);
   const pos=await page.evaluate(scene=>app.plugins.plugins['obcanvas-creator'].layout.getSnapshot().data.scenes[scene].positions,s.scene);
   assert.deepEqual(pos,s.positions);await button('总览').click();assert.ok(await node(s.script).isVisible());
  });
 }else{
  const before=await page.evaluate(()=>app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records);
  await button('新建场次').click();let s={};
  await check('不先创建镜头即可放入剧本，切换卡片时保存内容',async()=>{
   await button('＋ 剧本').click();s.script=await current();s.scene=(await record(s.script)).sceneId;
   await root.getByLabel('卡片标题',{exact:true}).fill('R1 · 中性剧本');await root.getByLabel('卡片内容',{exact:true}).fill('屋内的人听见敲门声，从书中抬头。');
   await button('＋ 人物').click();s.person=await current();assert.equal((await record(s.script)).body,'屋内的人听见敲门声，从书中抬头。');await close();
  });
  await check('建立镜头并连接剧本用途，普通编辑保留关系',async()=>{
   await button('＋ 镜头').click();s.shot=await current();await root.getByLabel('镜头标题',{exact:true}).fill('R1 · 抬头');await root.getByLabel('镜头内容',{exact:true}).fill('固定近景，抬眼看向门口。');await close();
   await button('总览').click();await button('从R1 · 中性剧本连接').click();await node(s.shot).click();
   assert.equal((await record(s.shot)).links[0].role,'剧情拆分');await choose(s.shot);await root.getByLabel('镜头内容',{exact:true}).fill('固定近景，听见敲门后抬眼。');await close();assert.equal((await record(s.shot)).links.length,1);
  });
  await check('图片文件独立入画布，原始文件保留，关闭详情后可连接起始帧',async()=>{
   await root.getByLabel('放入画布文件',{exact:true}).setInputFiles(resolve('.local/media-fixtures/参考图.png'));
   await page.waitForFunction(()=>app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().base?.kind==='asset');s.image=await current();
   await page.waitForFunction(id=>app.plugins.plugins['obcanvas-creator'].records.getSnapshot().records.find(r=>r.id===id)?.media?.length===1,s.image);
   const ref=(await record(s.image)).media[0];assert.deepEqual(await readFile(resolve(vault,ref.path)),await readFile('.local/media-fixtures/参考图.png'));await close();
   await button('总览').click();await button('从参考图.png连接').click();await root.getByLabel('连接用途',{exact:true}).selectOption('起始帧');await node(s.shot).click();assert.equal((await record(s.shot)).links.length,2);
  });
  await check('视频文件独立入画布，连接为候选，在目标镜头采用',async()=>{
   await root.getByLabel('放入画布文件',{exact:true}).setInputFiles(resolve('.local/media-fixtures/短视频.mp4'));
   await page.waitForFunction(()=>app.workspace.getLeavesOfType('obcanvas-film-view')[0].view.editor.getSnapshot().base?.title==='短视频.mp4');s.video=await current();await close();await button('总览').click();await button('从短视频.mp4连接').click();await node(s.shot).click();
   await choose(s.shot);await button('采用此视频').click();await root.locator('[data-decision="adopted"]').waitFor();assert.equal((await record(s.shot)).media[0].decision,'adopted');await close();
  });
  await check('自由拖动不改变镜头顺序，连线随位置保存',async()=>{
   await button('总览').click();const box=await node(s.script).boundingBox();assert.ok(box);const before=(await record(s.scene)).shotOrder;
   await page.mouse.move(box.x+50,box.y+40);await page.mouse.down();await page.mouse.move(box.x+90,box.y+70,{steps:6});await page.mouse.up();
   await page.evaluate(()=>app.plugins.plugins['obcanvas-creator'].layout.flush());assert.deepEqual((await record(s.scene)).shotOrder,before);
  });
  await check('移除起始帧关系不删除源图片或镜头',async()=>{
   await choose(s.shot);await button('移除起始帧关系').click();assert.equal((await record(s.shot)).links.length,1);assert.ok((await record(s.image)).media.length);await close();
  });
  await check('待办定位到未完成镜头，已采用镜头不重复催生成',async()=>{
   await button('＋ 镜头').click();s.todo=await current();await root.getByLabel('镜头标题',{exact:true}).fill('R1 · 待补镜头');await close();await button('查看待办').click();await root.locator('.obcanvas-task').filter({hasText:'R1 · 待补镜头'}).click();assert.equal(await current(),s.todo);await close();
  });
  await check('原生笔记修改刷新剧本，冲突保留本地草稿',async()=>{
   await choose(s.script);await root.getByLabel('卡片内容',{exact:true}).fill('本地待保存内容');
   await page.evaluate(async id=>{const plugin=app.plugins.plugins['obcanvas-creator'];const r=plugin.records.getSnapshot().records.find(r=>r.id===id);await app.vault.process(app.vault.getFileByPath(r.path),raw=>raw.replace('屋内的人听见敲门声，从书中抬头。','外部笔记修改'));await plugin.records.refresh();},s.script);
   await button('＋ 人物').click();await root.locator('[data-save-status="conflict"]').waitFor();assert.equal(await root.getByLabel('卡片内容',{exact:true}).inputValue(),'本地待保存内容');await button('放弃本地修改，载入笔记').click();await close();
  });
  await check('0.2.0 已有记录和采用决定全部保持原样',async()=>{for(const r of before)assert.deepEqual(await record(r.id),r);});
  s.records={};for(const id of [s.scene,s.script,s.shot,s.person,s.image,s.video,s.todo])s.records[id]=await record(id);
  await page.evaluate(()=>app.plugins.plugins['obcanvas-creator'].layout.flush());s.positions=await page.evaluate(scene=>app.plugins.plugins['obcanvas-creator'].layout.getSnapshot().data.scenes[scene].positions,s.scene);
  await writeFile('.local/r1-checkpoint.json',JSON.stringify(s,null,2));
 }
 await button('总览').click();await page.screenshot({path:'.local/r1-free-canvas.png'});
 await writeFile('.local/r1-results'+(process.argv.includes('--reopen')?'-reopen':'')+'.json',JSON.stringify({checks},null,2));
}catch(e){if(page){await page.screenshot({path:'.local/r1-error.png'}).catch(()=>{});await writeFile('.local/r1-error.txt',await page.locator('body').innerText()).catch(()=>{});}throw e;}finally{await browser.close();}

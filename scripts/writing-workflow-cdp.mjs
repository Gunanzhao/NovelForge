/* global console, fetch, process, setTimeout, clearTimeout, WebSocket, Buffer */
// Uses only fresh synthetic projects and an isolated WebView2 profile.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const evidenceDir=resolve('tmp/workflow-acceptance')
mkdirSync(evidenceDir,{recursive:true})
const run=resolve('tmp/workflow-'+Date.now())
mkdirSync(run,{recursive:true})
const port=9467, results={run,version:JSON.parse(readFileSync('package.json','utf8')).version}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
let socket, child, seq=0
const pending=new Map()
function cmd(method,params={}) { return new Promise((yes,no)=>{
  const id=++seq, timer=setTimeout(()=>{pending.delete(id);no(Error('CDP timeout: '+method))},60000)
  pending.set(id,{yes,no,timer});socket.send(JSON.stringify({id,method,params}))
}) }
async function call(name,args={}) {
  const r=await cmd('Runtime.evaluate',{expression:`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`,awaitPromise:true,returnByValue:true})
  if(r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
async function evaluate(expression) {
  const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
async function until(expression,label) {
  for(let i=0;i<100;i++){if(await evaluate(expression))return;await pause(100)}
  throw Error('Timed out: '+label+'; '+await evaluate('document.body.innerText.slice(-1800)'))
}
async function click(text,scope='document') {
  const expression=`(()=>{const e=[...${scope}.querySelectorAll('button')].find(e=>(e.textContent.trim()===${JSON.stringify(text)}||(e.matches('.nav-item')&&e.querySelector('span')?.textContent.trim()===${JSON.stringify(text)}))&&!e.disabled);if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true})()`
  await until(expression,'click '+text);await pause(120)
}
async function field(label,value,placeholder=false) {
  await evaluate(`(()=>{const e=${placeholder?`[...document.querySelectorAll('input,textarea')].find(e=>(e.placeholder||'').includes(${JSON.stringify(label)}))`:`[...document.querySelectorAll('label.field')].find(e=>e.querySelector('.field-label')?.textContent.trim()===${JSON.stringify(label)})?.querySelector('input,textarea,select')`};if(!e)throw Error('Missing field '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`)
}
async function shot(name){const r=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(evidenceDir,name+'.png'),Buffer.from(r.data,'base64'))}
try {
  let occupied=false
  try {await fetch(`http://127.0.0.1:${port}/json/list`);occupied=true}catch { /* Expected when the isolated process is absent or closing. */ }
  assert.equal(occupied,false,'dedicated audit port must be free')
  child=spawn(resolve('src-tauri/target/release/novelforge.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:resolve(run,'profile'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}})
  let page
  for(let i=0;i<100;i++) {try{page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page');if(page)break}catch { /* Expected when the isolated process is absent or closing. */ }await pause(200)}
  assert.ok(page,'isolated desktop launched')
  socket=new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r=>socket.addEventListener('open',r,{once:true}))
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);if(m.error) p.no(Error(m.error.message)); else p.yes(m.result)}})

  for(let i=0;i<100;i++) {
    const ready=await cmd('Runtime.evaluate',{expression:'!!window.__TAURI_INTERNALS__?.invoke',returnByValue:true})
    if(ready.result?.value)break
    await pause(100)
  }
  const projectPath=resolve(run,'project')
  mkdirSync(projectPath,{recursive:true})
  await until("document.body.innerText.includes('新建小说')",'landing')
  await click('新建小说')
  await field('选择项目文件夹',projectPath,true)
  await field('例如：雾港来信','六项写作流程验收',true)
  await click('创建并开始写作')
  await until("!!document.querySelector('.sidebar')",'workspace')
  await click('稿件导入')
  const source='# 导入验收甲\r\n林月拿到钥匙。她没有打开门。\r\n# 导入验收乙\r\n[[林月]]走进城门。'
  const sourcePath=resolve(run,'manuscript.md');writeFileSync(sourcePath,source)
  const dom=await cmd('DOM.getDocument')
  const input=await cmd('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'input[type=file]'})
  assert.ok(input.nodeId)
  await cmd('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[sourcePath]})
  await click('生成分章预览')
  await field('导入章节名称','导入验收甲')
  await evaluate("document.querySelector('.import-confirm input').click()")
  await shot('import-preview')
  await click('确认导入')
  await until("document.body.innerText.includes('已导入2个章节')",'import complete')
  let data=await call('open_project',{path:projectPath})
  const chapter=data.nodes.find(n=>n.title==='导入验收甲');assert.ok(chapter)
  assert.equal((await call('get_document',{input:{projectPath,nodeId:chapter.id}})).content,'# 导入验收甲\r\n林月拿到钥匙。她没有打开门。\r\n')
  assert.equal(readFileSync(sourcePath,'utf8'),source)
  results.import={count:2,sourceUnchanged:true,exactBody:true}
  await click('章节记忆')
  await until("!!document.querySelector('.memory-chapters')",'memory navigation')
  await evaluate("[...document.querySelectorAll('.memory-chapters button')].find(e=>e.textContent.startsWith('导入验收甲')).click()")
  await until("!!document.querySelector('.memory-editor textarea')",'memory editor')
  await field('章节摘要','林月取得钥匙，尚未开门。')
  await field('关键事件','取得钥匙。')
  await evaluate("document.querySelector('.memory-source-picker').open=true;const e=document.querySelector('.memory-source-text');e.focus();const from=e.value.indexOf('林月');e.setSelectionRange(from,from+7);e.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));document.dispatchEvent(new Event('selectionchange'));e.dispatchEvent(new KeyboardEvent('keyup',{key:'Shift',bubbles:true}));")
  await click('添加所选原文依据')
  await click('保存记忆草稿')
  await until("document.body.innerText.includes('草稿已保存')",'memory save')
  await click('确认这份章节记忆')
  await until("document.body.innerText.includes('作者确认已保存')",'memory confirm')
  await shot('memory-confirmed')
  data=await call('open_project',{path:projectPath})
  const memory=data.entities.find(e=>e.kind==='chapter-memory');assert.equal(memory.content.status,'confirmed');assert.equal(memory.content.sources[0].quote,'林月拿到钥匙。')
  results.memory={authorConfirmed:true,exactCitation:true}
  await click('定位来源段落')
  await until("!!document.querySelector('.cm-content')?.cmTile?.root?.view",'source jump editor')
  await evaluate("[...document.querySelectorAll('.inspector-region details')].find(e=>e.querySelector('summary')?.textContent.includes('批注与修订')).open=true")
  await click('批注当前选区')
  await field('批注内容','确认钥匙后续去向')
  await click('保存批注')
  await until("!!document.querySelector('.annotation-card')",'annotation saved')
  await evaluate("const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({changes:{from:0,insert:'开篇补充。\\n'}})")
  await pause(1400)
  await click('批注与修订',"document.querySelector('.sidebar')")
  await until("!!document.querySelector('.workspace .annotation-card')",'global annotation')
  await click('定位原文',"document.querySelector('.workspace')")
  const selectedQuote=await evaluate("(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;return v.state.sliceDoc(v.state.selection.main.from,v.state.selection.main.to)})()")
  assert.equal(selectedQuote,'林月拿到钥匙。')
  await click('批注与修订',"document.querySelector('.sidebar')")
  await click('标记已解决',"document.querySelector('.workspace')")
  await field('处理状态','resolved')
  await until("!!document.querySelector('.workspace .annotation-card')",'resolved annotation')
  await shot('annotation-resolved')
  results.annotation={selectionSaved:true,mappedAfterInsertion:true,resolved:true}
  await click('人物')
  await click('新建',"document.querySelector('.entity-list-head')")
  await field('输入人物名称','林月',true)
  await click('保存资料')
  await click('资料版本历史')
  await field('版本名称','改名前的设定')
  await click('保存命名版本')
  await until("[...document.querySelectorAll('.entity-history-panel option')].some(e=>e.textContent.includes('改名前的设定'))",'named entity version')
  await click('Wiki安全改名')
  await field('新资料名称','林霜')
  await click('预览改名影响')
  await until("!!document.querySelector('.wiki-rename-preview')",'rename preview')
  await shot('rename-preview')
  await click('确认改名并更新所选引用')
  await until("document.body.innerText.includes('改名已完成')",'rename applied')
  const second=data.nodes.find(n=>n.title==='导入验收乙')
  assert.ok((await call('get_document',{input:{projectPath,nodeId:second.id}})).content.includes('[[林霜]]'))
  await evaluate("(()=>{const e=document.querySelector('.wiki-rename-undo select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,[...e.options].find(o=>o.value&&!o.disabled).value);e.dispatchEvent(new Event('change',{bubbles:true}));})()")
  await click('撤销整次改名')
  await until("document.body.innerText.includes('已撤销整次改名')",'rename undone')
  assert.ok((await call('get_document',{input:{projectPath,nodeId:second.id}})).content.includes('[[林月]]'))
  results.historyAndRename={namedVersion:true,referenceUpdated:true,wholeUndo:true}
  await click('批注与修订')
  await until("document.body.innerText.includes('批注与修订任务')",'annotations navigation')
  await shot('annotation-empty')
  const backups=resolve(run,'backups');mkdirSync(backups,{recursive:true})
  await call('configure_auto_backup',{input:{projectPath,enabled:true,directory:backups,trigger:'session',keep:3}})
  const backed=await call('run_auto_backup',{input:{projectPath,manual:true}})
  assert.ok(backed.settings.archives.length)
  const archive=backed.settings.archives.at(-1)
  const restored=await call('restore_backup',{path:archive.path,directory:backups})
  const restoredData=await call('open_project',{path:restored.path})
  assert.equal(restoredData.entities.find(e=>e.id===memory.id).content.status,'confirmed')
  assert.ok((await call('get_document',{input:{projectPath:restored.path,nodeId:chapter.id}})).content.includes('林月拿到钥匙。她没有打开门。'))
  await call('release_project',{path:restored.path})
  await click('项目设置')
  await evaluate("document.querySelector('#settings-tab-data').click()")
  await until("document.body.innerText.includes('自动备份与恢复中心')",'backup settings')
  await shot('backup-settings')
  results.backup={archive:archive.path,restored:restored.path,memoryAndImportedBodyPreserved:true}
  results.status='passed';console.log(JSON.stringify(results,null,2))
}catch(e){results.error=String(e);process.exitCode=1;console.error(e);try{await shot('failure')}catch{ /* Keep original failure. */ }}
finally {
  writeFileSync(resolve(evidenceDir,'evidence.json'),JSON.stringify(results,null,2))
  socket?.close()
  for(const item of pending.values())clearTimeout(item.timer)
  if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true})}catch{ /* Already closed. */ }}
}

/* global console, fetch, process, setTimeout, clearTimeout, WebSocket, Buffer */
// Uses only fresh synthetic projects and an isolated WebView2 profile.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, sep } from 'node:path'
const evidenceDir=resolve('tmp/full-audit-acceptance')
mkdirSync(evidenceDir,{recursive:true})
const run=resolve('tmp/full-audit-'+Date.now())
mkdirSync(run,{recursive:true})
const port=9465, results={run,version:JSON.parse(readFileSync('package.json','utf8')).version}
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
function keepOutsideProject(path,label) {
  const normalized=resolve(path.replace(/^\\\\\?\\/,''))
  assert.ok(normalized.toLowerCase().startsWith((run+sep).toLowerCase()))
  renameSync(normalized,resolve(run,label))
}
async function create(label) {
  const projectPath=resolve(run,label)
  const data=await call('create_project',{input:{path:projectPath,title:label,author:'审查夹具',description:'合成测试',genre:'测试',targetWords:1000}})
  return {projectPath,data}
}
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
  const {projectPath,data}=await create('history-and-export')
  const chapter=data.nodes.find(n=>n.kind==='chapter')
  const original=await call('get_document',{input:{projectPath,nodeId:chapter.id}})
  await call('save_document_checked',{input:{projectPath,nodeId:chapter.id,content:'# 第一章\n\n1. 第一项\n2. 第二项\n\n- 甲\n- 乙\n\n正文内容。',reason:'手动保存'},expectedContent:original.content})
  await call('create_node',{input:{projectPath,kind:'volume',title:'第二卷',parentId:null}})
  writeFileSync(resolve(projectPath,'attachments/cover.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nV0AAAAASUVORK5CYII=','base64'))
  results.exports={}
  for(const format of ['docx','epub']) results.exports[format]=await call('export_project',{input:{projectPath,format,includeToc:false,...(format==='epub'?{coverPath:'attachments/cover.png'}:{})}})
  await call('create_history_snapshot',{input:{projectPath,nodeId:chapter.id,content:'必须可读的命名版本',kind:'named',name:'备份完整性测试'}})
  const history=await call('list_history',{input:{projectPath,nodeId:chapter.id}})
  assert.ok(history.length)
  keepOutsideProject(resolve(projectPath,history[0].path),'preserved-missing-history.md')
  await assert.rejects(call('backup_project',{path:projectPath,directory:run}), /备份缺失历史版本/)
  renameSync(resolve(run,'preserved-missing-history.md'),resolve(projectPath,history[0].path))
  const report=await call('backup_project',{path:projectPath,directory:run})
  const validated=await call('validate_backup',{path:report.path})
  const restored=await call('restore_backup',{path:report.path,directory:run})
  const historyRead=await call('read_history',{input:{projectPath:restored.path,revisionId:history[0].id}})
  assert.ok(historyRead)
  results.history={missingFileRejected:true,backup:report,validated,restored,historyReadable:true}

  const trashFixture=await create('trash-descendant')
  const victim=trashFixture.data.nodes.find(n=>n.kind==='chapter')
  const volume=trashFixture.data.nodes.find(n=>n.kind==='volume')
  await call('create_node',{input:{projectPath:trashFixture.projectPath,kind:'volume',title:'保留卷',parentId:null}})
  await call('delete_node',{input:{projectPath:trashFixture.projectPath,nodeId:volume.id}})
  const items=await call('list_trash',{path:trashFixture.projectPath})
  const item=items.find(i=>i.refId===volume.id)
  const basename=victim.filePath.split('/').at(-1)
  keepOutsideProject(resolve(item.trashPath,basename),'preserved-missing-trash-chapter.md')
  await assert.rejects(call('backup_project',{path:trashFixture.projectPath,directory:run}), /备份缺失回收站正文/)
  renameSync(resolve(run,'preserved-missing-trash-chapter.md'),resolve(item.trashPath.replace(/^\\\\\?\\/,''),basename))
  const trashBackup=await call('backup_project',{path:trashFixture.projectPath,directory:run})
  const trashValidated=await call('validate_backup',{path:trashBackup.path})
  const trashRestored=await call('restore_backup',{path:trashBackup.path,directory:run})
  await call('restore_trash',{input:{projectPath:trashRestored.path,nodeId:item.id}})
  const document=await call('get_document',{input:{projectPath:trashRestored.path,nodeId:victim.id}})
  assert.ok(document)
  results.trash={missingFileRejected:true,backup:trashBackup,validated:trashValidated,restored:trashRestored,chapterReadable:true}
  results.status='all assertions passed'
  console.log(JSON.stringify(results,null,2))
}catch(e){results.error=String(e);process.exitCode=1;console.error(e)}
finally {
  writeFileSync(resolve(evidenceDir,'backend-evidence.json'),JSON.stringify(results,null,2))
  if(socket?.readyState===WebSocket.OPEN){try{await call('confirm_window_close')}catch { /* Expected when the isolated process is absent or closing. */ }socket.close()}
  if(child?.pid){try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true})}catch { /* Expected when the isolated process is absent or closing. */ }}
}


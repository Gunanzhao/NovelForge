/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const expectedVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version
const run = resolve('tmp/reliability-ui-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve('src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9462' } })
let socket, seq = 0
const pending = new Map()
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async expression => { const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
const saveChecked = async ({ input }) => {
  const disk = await call('get_document', { input: { projectPath: input.projectPath, nodeId: input.nodeId } })
  return call('save_document_checked', { input, expectedContent: disk.content })
}
const call = (name, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
const click = text => ev(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('missing '+${JSON.stringify(text)});e.click()})()`)
const field = (selector, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing field');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
const waitFor = async expression => { for (let i = 0; i < 80; i++) { if (await ev(expression)) return; await sleep(150) } throw Error('Timed out: ' + expression) }
try {
  let target
  for (let i=0;i<100;i++) { try { target=(await(await fetch('http://127.0.0.1:9462/json/list')).json()).find(item=>item.type==='page'); if(target)break } catch { /* Wait for startup or keep the original failure. */ } await sleep(200) }
  assert.ok(target); socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data),task=pending.get(message.id);if(task){pending.delete(message.id);if(message.error)task.reject(Error(message.error.message));else task.resolve(message.result)}})
  await cmd('Runtime.enable'); await waitFor(`!!window.__TAURI_INTERNALS__?.invoke`)
  const projectPath=resolve(run,'project')
  let data=await call('create_project',{input:{path:projectPath,title:'可靠性验收',author:'',genre:'',description:'',targetWords:1000}})
  const volume=data.nodes.find(n=>n.kind==='volume')
  data=await call('create_node',{input:{projectPath,kind:'chapter',title:'继续写作章节',parentId:volume.id}})
  const chapter=data.nodes.find(n=>n.title==='继续写作章节')
  const text=Array.from({length:120},(_,i)=>`第${i+1}行：用于检验滚动位置恢复。`).join('\n')
  await saveChecked({input:{projectPath,nodeId:chapter.id,content:text,reason:'合成测试'}})
  const sessionKey='novelforge:editor-session:'+projectPath.replaceAll('\\','/').toLowerCase()
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{path:projectPath,title:'可靠性验收',updatedAt:''}]))});localStorage.setItem(${JSON.stringify(sessionKey)},${JSON.stringify(JSON.stringify({nodeId:chapter.id,positions:{[chapter.id]:{anchor:7,head:7,scrollTop:350,scrollLeft:0}}}))});location.reload()`)
  await sleep(800);await waitFor(`!!document.querySelector('.recent-project')`);await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.cm-content')`)
  assert.equal(await ev(`document.querySelector('.mode-switch .active').textContent.trim()`),'编辑')
  assert.ok(await ev(`document.querySelector('.topbar-title').textContent.includes('可靠性验收')`))
  assert.ok(await ev(`document.querySelector('.manuscript-view').textContent.includes('继续写作章节')`))
  const nav=async label=>{await ev(`(()=>{const b=[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}));if(!b)throw Error('missing nav');b.closest('details')?.setAttribute('open','');b.click()})()`);await sleep(220)}
  const capture=async label=>{const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,label+'.png'),Buffer.from(shot.data,'base64'))}
  await ev(`document.querySelector('.cm-scroller').scrollTop=350;document.querySelector('.cm-scroller').dispatchEvent(new Event('scroll'))`);await sleep(300)
  await nav('人物');assert.ok(await ev(`document.querySelector('.main-layout').classList.contains('inspector-closed')`));await nav('正文');await sleep(300)
  assert.ok(await ev(`document.querySelector('.cm-scroller').scrollTop>100`),'scroll restored')
  console.log('EDITOR_SESSION_AND_CONTEXT_OK')
  await ev(`document.querySelector('button[title="项目设置"]').click()`);await waitFor(`!!document.querySelector('.settings-view')`)
  await field('#settings-project input','可靠性验收已保存')
  // Exercise the same application event emitted by the native CloseRequested handler.
  await call('plugin:event|emit',{event:'novelforge:request-close',payload:null})
  await waitFor(`!!document.querySelector('[aria-label="有未保存的修改"]')`)
  assert.equal(await ev(`!!document.querySelector('[aria-label="正在保存并关闭…"]')`),false,'draft confirmation remains accessible during window close')
  await click('继续编辑')
  console.log('WINDOW_CLOSE_DRAFT_GUARD_OK')
  await nav('人物');await waitFor(`!!document.querySelector('[aria-label="有未保存的修改"]')`);await click('继续编辑')
  assert.equal(await ev(`document.querySelector('#settings-project input').value`),'可靠性验收已保存')
  await nav('人物');await click('保存后离开');await waitFor(`!!document.querySelector('.entity-list-head')`)
  assert.equal((await call('open_project',{path:projectPath})).project.title,'可靠性验收已保存')
  await field('input[placeholder="输入人物名称"]','保护人物')
  await nav('地点');await waitFor(`!!document.querySelector('[aria-label="有未保存的修改"]')`);await click('保存后离开')
  await waitFor(`document.querySelector('.entity-list-head h2')?.textContent==='地点'`)
  assert.ok((await call('list_entities',{path:projectPath,kind:'character'})).some(e=>e.title==='保护人物'))
  console.log('FORM_GUARD_OK')
  await nav('剧情线');await field('.story-arc-form input','可重复保存的剧情线');await click('保存剧情线');await sleep(250);await click('保存剧情线');await sleep(250)
  assert.equal((await call('list_entities',{path:projectPath,kind:'story-arc'})).filter(e=>e.title==='可重复保存的剧情线').length,1)
  await nav('正文');await waitFor(`!!document.querySelector('.cm-content')`)
  writeFileSync(resolve(projectPath,chapter.filePath),'外部编辑器版本','utf8')
  await ev(`document.querySelector('.cm-content').focus()`)
  await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65})
  await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:0,windowsVirtualKeyCode:65})
  await cmd('Input.insertText',{text:'本地冲突草稿'})
  await waitFor(`!!document.querySelector('[aria-label="正文存在外部修改"]')`)
  assert.equal(readFileSync(resolve(projectPath,chapter.filePath),'utf8'),'外部编辑器版本')
  const recoveries=await call('list_recovery',{path:projectPath});assert.ok(recoveries.length)
  assert.ok(recoveries.some(item=>readFileSync(item.path,'utf8').includes('本地冲突草稿')))
  await capture('conflict');await click('保留恢复副本并读取磁盘版本');await waitFor(`!document.querySelector('[aria-label="正文存在外部修改"]')`)
  assert.ok(await ev(`document.querySelector('.cm-content').textContent.includes('外部编辑器版本')`))
  console.log('EXTERNAL_CONFLICT_RECOVERY_OK')
  const backup=await call('backup_project',{path:projectPath,directory:run});const check=await call('validate_backup',{path:backup.path});assert.equal(check.fileCount,backup.fileCount)
  const restored=await call('restore_backup',{path:backup.path,directory:run});const restoredData=await call('open_project',{path:restored.path});assert.equal(restoredData.project.title,'可靠性验收已保存')
  assert.ok(restoredData.entities.some(e=>e.title==='保护人物'));await call('release_project',{path:restored.path})
  console.log('BACKUP_RESTORE_OK',restored.path)
  await nav('人物');await ev(`[...document.querySelectorAll('.entity-list-item')].find(e=>e.textContent.includes('保护人物')).click();window.confirm=()=>true`);await sleep(150)
  await click('移入回收站');await waitFor(`!![...document.querySelectorAll('.toast-notice button')].find(e=>e.textContent==='撤销移入回收站')`);await click('撤销移入回收站');await sleep(350)
  assert.ok((await call('list_entities',{path:projectPath,kind:'character'})).some(e=>e.title==='保护人物'))
  await ev(`document.querySelector('button[title="项目设置"]').click()`);await click('数据与日志');await capture('settings-backup')
  assert.ok(await ev(`document.querySelector('.version-info').textContent.includes(${JSON.stringify(expectedVersion)})`))
  console.log('UNDO_AND_VERSION_UI_OK')
  writeFileSync(resolve(run,'result.json'),JSON.stringify({projectPath,backup,restored,passed:true},null,2));console.log('RELIABILITY_UI_PASS',run)
} catch(error) {
  try { const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,'failure.png'),Buffer.from(shot.data,'base64'));console.log('FAILURE_SCREENSHOT',run) } catch { /* Wait for startup or keep the original failure. */ }
  throw error
} finally { socket?.close(); child.kill() }

/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/auto-names-ui-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve(process.env.NOVELFORGE_EXE || 'src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9471' } })
let socket, seq = 0
const pending = new Map()
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async expression => { const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
const saveChecked = async ({ input }) => {
  const disk = await call('get_document', { input: { projectPath: input.projectPath, nodeId: input.nodeId } })
  return call('save_document_checked', { input, expectedContent: disk.content })
}
const call = (name, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
const waitFor = async (expression, count = 100) => { for (let i=0;i<count;i++) { if (await ev(expression)) return; await sleep(250) } throw Error('Timed out: '+expression) }
const capture = async name => { const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,name+'.png'),Buffer.from(shot.data,'base64')) }

try {
  let target
  for (let i = 0; i < 100; i++) {
    try { target = (await (await fetch('http://127.0.0.1:9471/json/list')).json()).find(item => item.type === 'page'); if (target) break } catch { /* startup */ }
    await sleep(200)
  }
  assert.ok(target); socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), task = pending.get(message.id)
    if (task) { pending.delete(message.id); if (message.error) task.reject(Error(message.error.message)); else task.resolve(message.result) }
  })
  await cmd('Runtime.enable'); await waitFor('!!window.__TAURI_INTERNALS__?.invoke')
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  const projectPath = resolve(run, 'project')
  const data = await call('create_project', { input: { path: projectPath, title: '选区显示验收', author: '', genre: '', description: '', targetWords: 1000 } })
  for (const [title,kind,content] of [['林清舟','character',{alias:'清舟、林队长',description:'航海家'}],['清舟','location',{description:'同名港口'}],['长安城','location',{}],['Ann Lee','character',{}]]) await call('upsert_entity',{input:{projectPath,id:null,title,kind,content,tags:[]}})
  const chapter = data.nodes.find(node => node.kind === 'chapter')
  const original = '林清舟与清舟来到长安城。Ann Lee 看见 Anna。\n[[林清舟]] `长安城` https://x.test/Ann\n' + '普通正文，不应标记。\n'.repeat(12000)
  await saveChecked( { input: { projectPath, nodeId: chapter.id, content: original, reason: '合成选区测试' } })
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path: projectPath, title: '选区显示验收', updatedAt: '' }]))});location.reload()`)
  await sleep(800); await waitFor(`!!document.querySelector('.recent-project')`); await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.cm-content')?.cmTile?.root?.view`)
  await ev(`window.editor=()=>document.querySelector('.cm-content').cmTile.root.view`)
  const click = text => ev(`(()=>{const scope=[...document.querySelectorAll('[role="dialog"]')].filter(e=>e.getClientRects().length).at(-1)??document;const button=[...scope.querySelectorAll('button')].find(e=>e.getClientRects().length&&(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(text)});if(!button)throw Error('missing '+${JSON.stringify(text)});button.click()})()`)
  await waitFor(`document.querySelectorAll('.cm-auto-name').length>=4`)
  assert.deepEqual(await ev(`[...document.querySelectorAll('.cm-auto-name')].map(e=>e.textContent)`),['林清舟','清舟','长安城','Ann Lee'])
  assert.equal(await ev('editor().state.doc.toString()'),original)
  const clickName = async pos => {
    const point=await ev(`(()=>{const r=editor().coordsAtPos(${pos});return {x:r.left+2,y:(r.top+r.bottom)/2}})()`)
    await cmd('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1})
    await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1})
    await waitFor(`!!document.querySelector('[role="dialog"] .name-recognition-list')`)
  }
  const points=await ev(`[0,10].map(pos=>{const r=editor().coordsAtPos(pos);return {x:r.left+1,y:(r.top+r.bottom)/2}})`)
  await cmd('Input.dispatchMouseEvent',{type:'mousePressed',...points[0],button:'left',buttons:1,clickCount:1})
  await cmd('Input.dispatchMouseEvent',{type:'mouseMoved',...points[1],button:'left',buttons:1})
  await cmd('Input.dispatchMouseEvent',{type:'mouseReleased',...points[1],button:'left',buttons:0,clickCount:1})
  await sleep(400)
  assert.equal(await ev(`!!document.querySelector('[role="dialog"]')`),false,'Dragging names must not open a card')
  assert.ok(await ev(`!!document.querySelector('.editor-ai-floating')`))
  await clickName(1)
  await capture('name-card')
  await click('固定关联')
  await waitFor(`editor().state.doc.toString().startsWith('[[林清舟]]')`)
  await ev('editor().focus()')
  await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90})
  await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',modifiers:2,windowsVirtualKeyCode:90})
  assert.equal(await ev('editor().state.doc.toString()'),original)
  await sleep(500)
  await clickName(4)
  assert.equal(await ev(`document.querySelectorAll('.name-recognition-list section').length`),2)
  await capture('ambiguous-name')
  await click('忽略此名称')
  await waitFor(`!document.querySelector('[role="dialog"]') && ![...document.querySelectorAll('.cm-auto-name')].some(e=>e.textContent==='清舟')`)
  await click('项目设置');await click('编辑器')
  await ev(`document.querySelector('.name-recognition-settings details').open=true`)
  await click('恢复识别')
  await waitFor(`document.querySelector('.name-recognition-settings summary').textContent.includes('（0）')`)
  await ev(`document.querySelector('.name-recognition-settings input').click()`)
  await ev(`[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim()==='正文').click()`)
  await waitFor(`!!document.querySelector('.cm-content')`)
  await sleep(600)
  assert.equal(await ev(`document.querySelectorAll('.cm-auto-name').length`),0)
  await click('项目设置');await click('编辑器')
  await ev(`document.querySelector('.name-recognition-settings input').click()`)
  await ev(`[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim()==='正文').click()`)
  await waitFor(`document.querySelectorAll('.cm-auto-name').length>=4`)
  await ev(`editor().focus();editor().dispatch({selection:{anchor:0}})`)
  await cmd('Input.imeSetComposition',{text:'林队',selectionStart:2,selectionEnd:2})
  assert.equal(await ev('editor().composing'),true)
  await sleep(400)
  await cmd('Input.insertText',{text:'林队长'})
  await sleep(600)
  assert.ok(await ev(`[...document.querySelectorAll('.cm-auto-name')].some(e=>e.textContent==='林队长')`),'Names refresh after composition ends')
  await ev(`editor().dispatch({changes:{from:0,to:3,insert:''},selection:{anchor:0}})`)
  await sleep(400)
  const started=Date.now()
  await cmd('Input.insertText',{text:'测试输入。'})
  const typingMs=Date.now()-started
  assert.ok(typingMs<1500,'Typing blocked during name recognition')
  await sleep(600)
  const persisted=await call('get_document',{input:{projectPath,nodeId:chapter.id}})
  assert.ok(persisted.content===original || persisted.content==='测试输入。'+original)
  await capture('auto-names-editor')
  writeFileSync(resolve(run,'result.json'),JSON.stringify({result:'AUTO_NAMES_UI_PASS',characters:original.length,typingMs,originalUnchangedUntilExplicitPin:true,undo:true,ambiguity:true,ignoreRestore:true,toggle:true},null,2))
  console.log('AUTO_NAMES_UI_PASS '+run)
} catch(error) {
  if(socket){try{await capture('failure');console.log(await ev('document.body.innerText.slice(-1500)'))}catch{/* app exited */}}
  throw error
} finally {socket?.close();child.kill()}

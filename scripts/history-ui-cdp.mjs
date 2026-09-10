/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/history-ui-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve(process.env.NOVELFORGE_EXE || 'src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9478' } })
let socket, seq = 0
const pending = new Map()
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async expression => { const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
const call = (name, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
const waitFor = async (expression, count = 100) => { for (let i=0;i<count;i++) { if (await ev(expression)) return; await sleep(250) } throw Error('Timed out: '+expression) }
const capture = async name => { const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,name+'.png'),Buffer.from(shot.data,'base64')) }

try {
  let target
  for (let i = 0; i < 100; i++) {
    try { target = (await (await fetch('http://127.0.0.1:9478/json/list')).json()).find(item => item.type === 'page'); if (target) break } catch { /* startup */ }
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
  const chapter = data.nodes.find(node => node.kind === 'chapter')
  const original = '清晨，窗外落着细雨。\n短句。\n\n' + '她沿着石阶走到街角，停下来读信。'.repeat(10) + '\n另一行很短。\n最后一段只选择开头，其余文字保持原样。'
  await call('save_document', { input: { projectPath, nodeId: chapter.id, content: original, reason: '合成选区测试' } })
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path: projectPath, title: '选区显示验收', updatedAt: '' }]))});location.reload()`)
  await sleep(800); await waitFor(`!!document.querySelector('.recent-project')`); await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.cm-content')?.cmTile?.root?.view`)
  await ev(`window.editor=()=>document.querySelector('.cm-content').cmTile.root.view`)
  const history = () => call('list_history', { input: { projectPath, nodeId: chapter.id } })
  const save = (content, reason) => call('save_document', { input: { projectPath, nodeId: chapter.id, content, reason } })
  const click = label => ev(`(()=>{const scope=[...document.querySelectorAll('[role="dialog"]')].filter(e=>e.getClientRects().length).at(-1)??document;const button=[...scope.querySelectorAll('button')].find(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('Missing button '+${JSON.stringify(label)});button.click()})()`)
  const initial = (await history()).length
  await save('内容一', '手动保存')
  await save('内容二', '自动保存')
  await save('内容三', '自动保存')
  assert.equal((await history()).length, initial)
  await call('create_history_snapshot', { input: { projectPath, nodeId: chapter.id, content: '内容三', kind: 'checkpoint' } })
  await call('create_history_snapshot', { input: { projectPath, nodeId: chapter.id, content: '内容三', kind: 'checkpoint' } })
  assert.equal((await history()).length, initial + 1)
  await ev('location.reload()');await sleep(800);await waitFor(`!!document.querySelector('.recent-project')`)
  await ev(`document.querySelector('.recent-project').click()`);await waitFor(`!!document.querySelector('.cm-content')`)
  await click('版本历史');await click('保存版本')
  await waitFor(`!!document.querySelector('[placeholder="例如：修改结局前"]')`)
  await ev(`(()=>{const input=document.querySelector('[placeholder="例如：修改结局前"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'结局修改前');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('保存版本')
  await waitFor(`!document.querySelector('[role="dialog"]')`)
  await waitFor(`[...document.querySelectorAll('.history-item strong')].some(e=>e.textContent==='命名版本：结局修改前')`)
  assert.equal((await history()).length, initial + 2)
  const milestone = (await history()).find(item => item.reason === '命名版本：结局修改前')
  assert.equal(await call('read_history', { input: { projectPath, revisionId: milestone.id } }), '内容三')
  await ev(`document.querySelector('.history-tools').scrollIntoView({block:'start'})`)
  await sleep(200)
  await capture('named-history')
  await ev(`(()=>{const view=document.querySelector('.cm-content').cmTile.root.view;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:'离开前最后一稿'}})})()`)
  await waitFor(`document.querySelector('.statusbar')?.textContent.includes('正文已保存') || [...document.querySelectorAll('.editor-status')].some(e=>e.textContent.includes('已保存'))`)
  const beforeClose = (await history()).length
  await click('关闭')
  await waitFor(`!!document.querySelector('.recent-project')`)
  await ev(`document.querySelector('.recent-project').click()`);await waitFor(`!!document.querySelector('.cm-content')`)
  assert.equal((await history()).length, beforeClose + 1)
  const latest=(await history())[0]
  assert.equal(await call('read_history', { input: { projectPath, revisionId: latest.id } }), '离开前最后一稿')
  writeFileSync(resolve(run,'result.json'),JSON.stringify({result:'HISTORY_UI_PASS',initial,total:(await history()).length},null,2))
  console.log('HISTORY_UI_PASS '+run)
} catch(error) {
  if(socket){try{await capture('failure')}catch{/* app exited */}}
  throw error
} finally {socket?.close();child.kill()}

/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/rename-ui-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve(process.env.NOVELFORGE_EXE || 'src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9486' } })
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
    try { target = (await (await fetch('http://127.0.0.1:9486/json/list')).json()).find(item => item.type === 'page'); if (target) break } catch { /* startup */ }
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
  const original = '# 第一章\n\n改名前的正文。'
  await call('save_document', { input: { projectPath, nodeId: chapter.id, content: original, reason: '合成选区测试' } })
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path: projectPath, title: '选区显示验收', updatedAt: '' }]))});location.reload()`)
  await sleep(800); await waitFor(`!!document.querySelector('.recent-project')`); await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.cm-content')?.cmTile?.root?.view`)
  await ev(`window.editor=()=>document.querySelector('.cm-content').cmTile.root.view`)

  await ev(`document.querySelector('.tree-row .tree-toggle').click()`)
  await waitFor(`!!document.querySelector('.tree-document-row')`)
  await ev(`window.prompt=()=> '新的章节名称';document.querySelector('.tree-document-row').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
  await waitFor(`document.querySelector('.editor-header')?.textContent.includes('新的章节名称') || document.body.textContent.includes('新的章节名称')`)
  await waitFor(`editor().state.doc.toString().startsWith('# 新的章节名称')`)
  const editorAfterRename=await ev('editor().state.doc.toString()')
  await ev(`editor().dispatch({changes:{from:editor().state.doc.length,insert:'继续输入的新句子。'}})`)
  await waitFor(`(async()=> (await window.__TAURI_INTERNALS__.invoke('get_document',{input:{projectPath:${JSON.stringify(projectPath)},nodeId:${JSON.stringify(chapter.id)}}})).content.endsWith('继续输入的新句子。'))()`)
  await capture('rename-saved')
  const disk = await call('get_document',{input:{projectPath,nodeId:chapter.id}})
  assert.equal(editorAfterRename,original.replace('# 第一章','# 新的章节名称'))
  assert.equal(await ev(`document.body.textContent.includes('正文存在外部修改')`),false)
  assert.ok(disk.content.startsWith('# 新的章节名称'))
  writeFileSync(resolve(run,'result.json'),JSON.stringify({editorAfterRename,diskContent:disk.content,conflictDialog:false},null,2))
  console.log('RENAME_UI_PASS '+run)
} finally {socket?.close();child.kill()}

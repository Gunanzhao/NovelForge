/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/inspector-width-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve(process.env.NOVELFORGE_EXE || 'src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9471' } })
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
  const chapter = data.nodes.find(node => node.kind === 'chapter')
  const original = '清晨，窗外落着细雨。\n短句。\n\n' + '她沿着石阶走到街角，停下来读信。'.repeat(10) + '\n另一行很短。\n最后一段只选择开头，其余文字保持原样。'
  await call('save_document', { input: { projectPath, nodeId: chapter.id, content: original, reason: '合成选区测试' } })
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path: projectPath, title: '选区显示验收', updatedAt: '' }]))});location.reload()`)
  await sleep(800); await waitFor(`!!document.querySelector('.recent-project')`); await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.cm-content')?.cmTile?.root?.view`)
  await ev(`window.editor=()=>document.querySelector('.cm-content').cmTile.root.view`)
  const records = []
  for (const width of [420, 278, 220, 400]) {
    await ev(`localStorage.setItem('novelforge:workspace-preferences:v1',JSON.stringify({inspectorWidth:${width}}));location.reload()`)
    await sleep(800);await waitFor(`!!document.querySelector('.recent-project')`)
    await ev(`document.querySelector('.recent-project').click()`)
    await waitFor(`!!document.querySelector('.cm-content')`)
    for (const viewport of [1440, 2560, 1180]) {
      await cmd('Emulation.setDeviceMetricsOverride',{width:viewport,height:900,deviceScaleFactor:1,mobile:false})
      await sleep(350)
      const measure = () => ev(`(()=>{const panel=[...document.querySelectorAll('.inspector-region,.ai-host')].find(e=>e.getClientRects().length),p=panel.getBoundingClientRect(),w=document.querySelector('.workspace').getBoundingClientRect();return {panelWidth:p.width,panelLeft:p.left,workspaceWidth:w.width,overflow:document.documentElement.scrollWidth>innerWidth+1}})()`)
      const chapterSize=await measure()
      await ev(`document.querySelector('.inspector-region [role="tab"]:last-child').click()`)
      await sleep(350)
      const aiSize=await measure()
      console.log('TAB_WIDTH',JSON.stringify({width,viewport,chapterSize,aiSize}))
      assert.deepEqual(aiSize,chapterSize,'Tab switch must preserve sidebar and manuscript geometry')
      assert.equal(aiSize.overflow,false)
      if(viewport===1440&&width===420)await capture('ai-width-420')
      await ev(`document.querySelector('.ai-host [role="tab"]:first-child').click()`)
      await sleep(350)
      assert.deepEqual(await measure(),chapterSize)
      if(viewport===1440&&width===420)await capture('chapter-width-420')
      records.push({width,viewport,...aiSize})
    }
  }
  writeFileSync(resolve(run,'result.json'),JSON.stringify({result:'INSPECTOR_WIDTH_PASS',records},null,2))
  console.log('INSPECTOR_WIDTH_PASS '+run)
} catch(error) {
  if(socket){try{await capture('failure')}catch{/* app exited */}}
  throw error
} finally {socket?.close();child.kill()}

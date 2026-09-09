/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/editor-selection-ui-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve(process.env.NOVELFORGE_EXE || 'src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9471' } })
let socket, seq = 0
const pending = new Map()
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async expression => { const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
const call = (name, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
const click = text => ev(`(()=>{const scope=[...document.querySelectorAll('[role="dialog"]')].filter(e=>e.getClientRects().length).at(-1)??document;const e=[...scope.querySelectorAll('button')].find(e=>e.getClientRects().length&&(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(text)});if(!e)throw Error('missing '+${JSON.stringify(text)});e.click()})()`)
const waitFor = async (expression, count = 100) => { for (let i=0;i<count;i++) { if (await ev(expression)) return; await sleep(250) } throw Error('Timed out: '+expression) }
const capture = async name => { const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,name+'.png'),Buffer.from(shot.data,'base64')) }

function contrast(background, foreground) {
  const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const values = [luminance(background), luminance(foreground)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
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
  for (const theme of ['light', 'dark']) {
    await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
    for (const focus of [false, true]) {
      if (focus) {
        await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 })
        await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 })
      }
      await sleep(300)
      assert.equal(await ev(`document.querySelector('.app-shell').classList.contains('focus-mode')`), focus)
      for (const [name, from, to] of [['single', 2, 9], ['multiline', 2, original.indexOf('最后一段') + 4], ['reverse', original.indexOf('最后一段') + 4, 2]]) {
        await ev(`editor().focus();editor().dispatch({selection:{anchor:0}});editor().scrollDOM.scrollTop=0`)
        await sleep(100)
        const points = await ev(`[${from},${to}].map(pos=>{const r=editor().coordsAtPos(pos);return {x:r.left,y:(r.top+r.bottom)/2}})`)
        await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...points[0], button: 'left', buttons: 1, clickCount: 1 })
        for (let step = 1; step <= 12; step++) {
          await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[0].x + (points[1].x - points[0].x) * step / 12, y: points[0].y + (points[1].y - points[0].y) * step / 12, button: 'left', buttons: 1 })
        }
        await sleep(100)
        const actual = await ev(`(()=>{const s=editor().state.selection.main,c=document.querySelector('.cm-content'),style=getComputedStyle(c,'::selection');return {text:editor().state.sliceDoc(s.from,s.to),native:window.getSelection().toString(),layers:document.querySelectorAll('.cm-selectionLayer').length,background:style.backgroundColor,foreground:style.color}})()`)
        assert.equal(actual.text, original.slice(Math.min(from, to), Math.max(from, to)))
        assert.equal(actual.native, actual.text)
        assert.equal(actual.layers, 0)
        assert.ok(await ev(`Array.from(document.querySelectorAll('.cm-activeLine,.cm-activeLineGutter')).every(e=>getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)')`))
        assert.ok(contrast(actual.background, actual.foreground) >= 4.5, JSON.stringify(actual))
        if (name === 'multiline') await capture(`${theme}-${focus ? 'focus' : 'normal'}-drag`)
        await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points[1], button: 'left', buttons: 0, clickCount: 1 })
        await sleep(350)
        assert.ok(await ev(`!!document.querySelector('.editor-ai-floating')`), `toolbar disappeared after mouse release: ${theme}/${focus}/${name}`)
        assert.equal(await ev(`window.getSelection().toString()`), actual.text)
        if (name === 'multiline') await capture(`${theme}-${focus ? 'focus' : 'normal'}-released`)
        records.push({ theme, focus, name, contrast: contrast(actual.background, actual.foreground), background: actual.background, foreground: actual.foreground })
      }
      if (focus) {
        await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 })
        await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 })
      }
    }
  }
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', modifiers: 8, windowsVirtualKeyCode: 39 })
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', modifiers: 8, windowsVirtualKeyCode: 39 })
  await sleep(350)
  assert.ok(await ev(`!!document.querySelector('.editor-ai-floating')`), 'toolbar disappeared after Shift+Arrow release')
  const selectedText = await ev(`window.getSelection().toString()`)
  const buttonPoint = await ev(`(()=>{const r=document.querySelector('.editor-ai-floating button').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', ...buttonPoint, button: 'left', buttons: 1, clickCount: 1 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', ...buttonPoint, button: 'left', buttons: 0, clickCount: 1 })
  await waitFor(`!document.querySelector('.ai-host').hidden`)
  await click('预览上下文')
  await waitFor(`!!document.querySelector('.ai-preview-panel')`)
  assert.ok(await ev(`document.querySelector('.ai-preview-panel').textContent.includes(${JSON.stringify(selectedText)})`))
  assert.equal(await ev('editor().state.doc.toString()'), original)
  await click('返回编辑')
  await ev(`[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim()==='正文').click()`)
  await waitFor(`document.querySelector('.cm-content').getClientRects().length>0`)
  await ev(`editor().dispatch({changes:{from:0,to:editor().state.doc.length,insert:'海风与海风'}});editor().focus();editor().dispatch({selection:{anchor:0,head:2}})`)
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', modifiers: 2, windowsVirtualKeyCode: 68 })
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', modifiers: 2, windowsVirtualKeyCode: 68 })
  assert.equal(await ev('editor().state.selection.ranges.length'), 1)
  await cmd('Input.insertText', { text: '雨' })
  assert.equal(await ev(`(editor().state.doc.toString().match(/海风/g)||[]).length`), 1)
  const changed = await ev('editor().state.doc.toString()')
  for (const [key, code, expected] of [['z', 90, '海风与海风'], ['y', 89, changed]]) {
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key, code: 'Key' + key.toUpperCase(), modifiers: 2, windowsVirtualKeyCode: code })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code: 'Key' + key.toUpperCase(), modifiers: 2, windowsVirtualKeyCode: code })
    assert.equal(await ev('editor().state.doc.toString()'), expected)
  }
  writeFileSync(resolve(run, 'result.json'), JSON.stringify({ result: 'EDITOR_SELECTION_UI_PASS', records }, null, 2))
  console.log('EDITOR_SELECTION_UI_PASS ' + run)
} catch (error) {
  if (socket) { try { await capture('failure') } catch { /* app exited */ } }
  throw error
} finally { socket?.close(); child.kill() }


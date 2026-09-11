/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/name-generator-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const requests = []
const server = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk
  requests.push(JSON.parse(body))
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify([{ name: '林潮生', explanation: '潮汐与新生的创作意象' }, { name: '林海澜', explanation: '海洋文明的创作意象' }]) } }] }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const child = spawn(resolve('src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9457' } })
let socket, seq = 0
const pending = new Map()
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async expression => { const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
const call = (name, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
const click = text => ev(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('missing '+${JSON.stringify(text)});e.click()})()`)
const field = (selector, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing field');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
const waitFor = async expression => { for (let i = 0; i < 80; i++) { if (await ev(expression)) return; await sleep(150) } throw Error('Timed out: ' + expression) }
try {
  let target
  for (let i = 0; i < 100; i++) { try { target = (await (await fetch('http://127.0.0.1:9457/json/list')).json()).find(item => item.type === 'page'); if (target) break } catch { /* WebView starts asynchronously. */ } await sleep(200) }
  assert.ok(target, 'CDP target starts')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  socket.addEventListener('message', event => { const message = JSON.parse(event.data), task = pending.get(message.id); if (task) { pending.delete(message.id); if (message.error) task.reject(Error(message.error.message)); else task.resolve(message.result) } })
  await cmd('Runtime.enable')
  await waitFor(`!!window.__TAURI_INTERNALS__?.invoke`)
  const projectPath = resolve(run, 'project')
  const project = await call('create_project', { input: { path: projectPath, title: '名字工具合成验证', author: '', genre: '', description: '', targetWords: 1000 } })
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path: projectPath, title: '名字工具合成验证', updatedAt: '' }]))});location.reload()`)
  await sleep(900)
  await waitFor(`!!document.querySelector('.recent-project')`)
  await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.app-shell')`)
  await ev(`[...document.querySelectorAll('.tree-row button[title="展开"]')].forEach(button=>button.click())`)
  await sleep(200)
  await ev(`(()=>{const e=[...document.querySelectorAll('.tree-row')].find(e=>e.textContent.includes(${JSON.stringify(project.nodes.find(node => node.kind === 'chapter').title)}));e.click()})()`)
  await waitFor(`!!document.querySelector('.name-generator-entry')`)
  await ev(`document.querySelector('.name-generator-entry').click()`)
  await field('input[aria-label="生成数量"]', '30')
  await click('生成')
  await waitFor(`document.querySelectorAll('.name-suggestion').length===30`)
  const first = await ev(`document.querySelector('.name-suggestion strong').textContent`)
  await ev(`document.querySelector('.name-suggestion button[aria-label^="锁定"]').click();document.querySelector('.name-suggestion button[aria-label^="收藏"]').click()`)
  await click('重新生成')
  assert.equal(await ev(`document.querySelector('.name-suggestion strong').textContent`), first)
  const metrics = []
  for (const [width, height] of [[1440, 900], [1100, 650]]) {
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await sleep(200)
    const measure = await ev(`(()=>{const dialog=document.querySelector('.modal-card'),list=document.querySelector('.name-suggestions'),r=dialog.getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,listHeight:list.clientHeight,listScroll:list.scrollHeight,bodyWidth:document.body.scrollWidth}})()`)
    assert.ok(measure.left >= 0 && measure.right <= width && measure.top >= 0 && measure.bottom <= height)
    assert.ok(measure.listScroll > measure.listHeight && measure.bodyWidth <= width)
    metrics.push(measure)
    const screenshot = await cmd('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(run, `generator-${width}.png`), Buffer.from(screenshot.data, 'base64'))
  }
  await click('收藏夹'); assert.equal(await ev(`document.querySelectorAll('.name-suggestion').length`), 1)
  await click('最近生成'); await click('恢复结果')
  await ev(`document.querySelector('.modal-card button[aria-label="关闭"]').click()`)
  assert.equal(await ev(`document.querySelector('.inspector .name-suggestions')`), null)
  assert.ok(await ev(`(()=>{const inner=document.querySelector('.inspector-inner'),region=document.querySelector('.inspector-region');return inner.clientHeight<=region.clientHeight})()`))
  await ev(`document.querySelector('.name-generator-entry').click()`)
  await field('input[aria-label="生成数量"]', '6')
  await ev(`[...document.querySelectorAll('summary')].find(e=>e.textContent==='可选 AI 命名').click()`)
  await field('.name-ai-fields .field-grid input', 'http://127.0.0.1:' + server.address().port + '/v1')
  await field('.name-ai-fields .field-grid .field:nth-child(2) input', 'synthetic-model')
  await field('.name-ai-fields textarea', '仅供测试的海洋文明背景')
  await click('发送并生成 AI 名字')
  await waitFor(`!![...document.querySelectorAll('.name-suggestion strong')].find(e=>e.textContent==='林潮生')`)
  assert.equal(requests.length, 1)
  assert.ok(requests[0].messages.some(message => message.content.includes('仅供测试的海洋文明背景')))
  assert.ok(await ev(`document.querySelector('.name-suggestions').textContent.includes('潮汐与新生')`))
  await ev(`document.querySelector('.name-create').click()`)
  await waitFor(`!document.querySelector('.modal-card')`)
  const reopened = await call('open_project', { path: projectPath })
  assert.ok(reopened.entities.some(entity => entity.title === '林潮生' && entity.content.summary.includes('潮汐')))
  await ev(`document.querySelector('.name-generator-entry').click()`)
  await waitFor(`!!document.querySelector('.name-suggestions')`)
  assert.ok(await ev(`document.querySelector('.name-suggestions').textContent.includes('已有 1 个同名条目')`))
  writeFileSync(resolve(run, 'metrics.json'), JSON.stringify(metrics, null, 2))
  console.log('NAME_GENERATOR_DESKTOP_PASS', run)
} finally { socket?.close(); child.kill(); server.closeAllConnections(); server.close() }

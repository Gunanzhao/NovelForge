/* global Buffer, console, fetch, process, setTimeout, clearTimeout, WebSocket */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Local protocol fixture only: no DeepSeek account or paid generation is used.
const run = resolve('tmp/deepseek-native-' + Date.now())
for (const dir of ['', 'profile', 'appdata', 'localappdata', 'project']) mkdirSync(join(run, dir), { recursive: true })
const sleep = ms => new Promise(done => setTimeout(done, ms))
let responseMode = 'normal', modelsCalls = 0, cancelled = false
const requests = [], timers = new Set(), errors = []
const later = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn() }, ms); timers.add(timer); return timer }
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/models') {
    modelsCalls++
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: [{ id: 'deepseek-flash', name: 'DeepSeek Flash', max_output_tokens: 393216 }, { id: 'deepseek-v4-pro' }] }))
    return
  }
  let raw = ''
  request.on('data', chunk => { raw += chunk })
  request.on('end', () => {
    const body = JSON.parse(raw), mode = responseMode
    requests.push(body)
    assert.equal(request.headers.authorization, 'Bearer synthetic-deepseek-key')
    assert.equal(request.url, '/chat/completions')
    if (mode === 'balance') {
      response.writeHead(402, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'PRIVATE_ERROR_DETAILS' } }))
      return
    }
    const content = '海风掀开信封。远处的灯塔亮了。'
    const usage = { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200, completion_tokens_details: { reasoning_tokens: 40 }, prompt_cache_hit_tokens: 30 }
    if (!body.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ model: 'deepseek-flash', choices: [{ message: { content }, finish_reason: 'stop' }], usage }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
    const send = value => { if (!response.destroyed) response.write(`data: ${JSON.stringify(value)}\r\n\r\n`) }
    response.write(': keep-alive\r\n\r\n')
    send({ model: 'deepseek-flash', choices: [{ index: 0, delta: { reasoning_content: 'SYNTHETIC_PRIVATE_REASONING' } }] })
    later(() => send({ choices: [{ index: 0, delta: { content: '海风掀开信封。' } }] }), 200)
    if (mode === 'delayed') {
      response.on('close', () => { if (!response.writableEnded) cancelled = true })
      return
    }
    later(() => send({ choices: [{ index: 0, delta: { content: '远处的灯塔亮了。' } }] }), 650)
    later(() => {
      if (response.destroyed) return
      send({ choices: [{ index: 0, delta: {}, finish_reason: mode === 'truncated' ? 'length' : 'stop' }], usage })
      response.end('data: [DONE]\r\n\r\n')
    }, 1300)
  })
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const endpoint = `http://127.0.0.1:${server.address().port}/chat/completions`
const port = 9497
const child = spawn(resolve('src-tauri/target/release/novelforge.exe'), ['--diagnostic-webview', String(port), join(run, 'profile')], { windowsHide: true, stdio: 'ignore', env: { ...process.env, APPDATA: join(run, 'appdata'), LOCALAPPDATA: join(run, 'localappdata') } })
let socket, seq = 0
const pending = new Map()
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async expression => { const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
const call = (command, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`)
const wait = async expression => { for (let i = 0; i < 120; i++) { if (await ev(expression)) return; await sleep(100) } throw Error('UI timeout: ' + expression) }
const click = async label => {
  await ev(`(()=>{const scope=[...document.querySelectorAll('[role="dialog"]')].filter(e=>e.checkVisibility()).at(-1)??document;const el=[...scope.querySelectorAll('button')].find(e=>e.checkVisibility()&&(e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)}));if(!el)throw Error('Missing action: '+${JSON.stringify(label)});el.click()})()`)
  await sleep(120)
}
const fill = async (label, value) => {
  await ev(`(()=>{const scope=[...document.querySelectorAll('[role="dialog"]')].filter(e=>e.checkVisibility()).at(-1)??document;const el=[...scope.querySelectorAll('input,select')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.closest('label')?.querySelector('span')?.textContent===${JSON.stringify(label)});if(!el)throw Error('Missing field: '+${JSON.stringify(label)});Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`)
  await sleep(120)
}
const capture = async name => writeFileSync(join(run, name + '.png'), Buffer.from((await cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
try {
  let target
  for (let i = 0; i < 160; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && p.url.startsWith('http://tauri.localhost')) } catch { /* bounded startup */ } if (target) break; await sleep(150) }
  assert.ok(target)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(done => socket.addEventListener('open', done, { once: true }))
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); const task = pending.get(message.id); if (task) { pending.delete(message.id); if (message.error) task.reject(Error(message.error.message)); else task.resolve(message.result) } })
  await cmd('Runtime.enable')
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await wait('!!document.querySelector(".welcome")')
  const projectPath = join(run, 'project')
  const data = await call('create_project', { input: { path: projectPath, title: 'DeepSeek 兼容验收', author: '', description: '', genre: '', targetWords: 1000 } })
  const node = data.nodes.find(node => node.kind === 'chapter')
  const original = await call('get_document', { input: { projectPath, nodeId: node.id } })
  const prefs = { mode: 'provider', providerKind: 'deepseek', providerName: 'DeepSeek 测试', endpoint, model: 'deepseek-flash', thinking: 'disabled', stream: true, maxTokens: 8192, timeoutSeconds: 300 }
  await ev(`localStorage.setItem('novelforge:ai-preferences:v1',${JSON.stringify(JSON.stringify(prefs))});localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path: projectPath, title: data.project.title, updatedAt: new Date().toISOString() }]))})`)
  await cmd('Page.reload'); await wait('!!document.querySelector(".recent-project")'); await ev('document.querySelector(".recent-project").click()')
  await wait('!!document.querySelector(".cm-content")')
  await ev('[...document.querySelectorAll(".nav-item")].find(e=>e.textContent.trim()==="AI 辅助").click()')
  await click('连接设置'); await fill('DeepSeek API Key', 'synthetic-deepseek-key')
  await click('检查连接 / 获取模型'); await wait('document.querySelector(".provider-settings").textContent.includes("连接成功")')
  assert.equal(modelsCalls, 1); assert.equal(requests.length, 0)
  await fill('思考模式', 'enabled'); await fill('思考强度', 'low')
  assert.equal(await ev('document.querySelector(".provider-settings input[type=number]").disabled'), true)
  await capture('deepseek-settings')
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false })
  assert.equal(await ev('(()=>{const e=document.querySelector("[role=dialog]");return e.scrollWidth>e.clientWidth+1})()'), false)
  await capture('deepseek-settings-1100'); await click('关闭')
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await click('续写'); await click('运行辅助')
  await wait('document.querySelector(".ai-result-text")?.value==="海风掀开信封。"')
  assert.equal(await ev('document.querySelector(".ai-result-text").readOnly'), true)
  assert.equal(await ev('document.body.innerText.includes("SYNTHETIC_PRIVATE_REASONING")'), false)
  assert.equal(await ev('[...document.querySelectorAll(".ai-result-actions button")].some(e=>/追加|替换|插入/.test(e.textContent))'), false)
  await capture('deepseek-streaming')
  await wait('document.querySelector(".ai-output-heading").textContent.includes("已完成")')
  assert.equal(requests[0].thinking.type, 'enabled'); assert.equal(requests[0].reasoning_effort, 'low')
  assert.equal(requests[0].temperature, undefined); assert.ok(requests[0].max_tokens >= 16384)
  assert.ok(await ev('document.querySelector(".ai-usage").textContent.includes("思考 40")'))
  assert.equal((await call('get_document', { input: { projectPath, nodeId: node.id } })).content, original.content)
  responseMode = 'truncated'; await click('运行辅助')
  await wait('document.querySelector(".ai-output-heading").textContent.includes("结果不完整")')
  assert.equal(await ev('[...document.querySelectorAll(".ai-result-actions button")].some(e=>/追加|替换|插入/.test(e.textContent))'), false)
  responseMode = 'delayed'; await click('运行辅助'); await wait('document.querySelector(".ai-result-text")?.value==="海风掀开信封。"'); await click('停止接收')
  for (let i = 0; i < 100 && !cancelled; i++) await sleep(20)
  assert.equal(cancelled, true, 'stop closes the streaming HTTP connection')
  responseMode = 'balance'; await click('运行辅助'); await wait('document.querySelector(".ai-task-error")?.textContent.includes("余额不足")')
  assert.equal(await ev('document.body.innerText.includes("PRIVATE_ERROR_DETAILS")'), false)
  responseMode = 'normal'; await click('连接设置'); await fill('输出方式', 'complete'); await fill('思考模式', 'disabled'); await click('关闭'); await click('运行辅助')
  await wait('document.querySelector(".ai-output-heading").textContent.includes("已完成")')
  assert.equal(requests.at(-1).thinking.type, 'disabled'); assert.ok(!requests.at(-1).stream)
  await capture('deepseek-complete')
  await click('追加到正文')
  for (let i = 0; i < 80; i++) { if ((await call('get_document', { input: { projectPath, nodeId: node.id } })).content.includes('海风掀开信封')) break; await sleep(100) }
  assert.ok((await call('get_document', { input: { projectPath, nodeId: node.id } })).content.includes('海风掀开信封'))
  assert.equal(await ev('JSON.stringify(localStorage).includes("synthetic-deepseek-key")'), false)
  assert.deepEqual(errors, [])
  writeFileSync(join(run, 'result.json'), JSON.stringify({ result: 'PASS', modelsCalls, generationCalls: requests.length, streaming: true, thinkingParameters: true, cancelled, truncatedProtected: true, nonStreaming: true, savedAfterExplicitApply: true, keyPersisted: false, paidGeneration: false, errors }, null, 2))
  console.log('PASS DeepSeek desktop protocol, configuration, streaming, cancellation, truncated protection, usage and explicit apply: ' + run)
} catch (error) { if (socket) try { await capture('failure'); console.log(await ev('document.body.innerText.slice(-2500)')) } catch { /* disconnected */ } throw error }
finally {
  socket?.close(); for (const timer of timers) clearTimeout(timer)
  if (child.pid) try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* exited */ }
  server.closeAllConnections(); server.close()
}

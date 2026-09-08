/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/codex-compatibility-ui-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve('src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9467' } })
let socket, seq = 0
const pending = new Map()
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async expression => { const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
const call = (name, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
const click = text => ev(`(()=>{const scope=[...document.querySelectorAll('[role="dialog"]')].at(-1)??document;const e=[...scope.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(text)});if(!e)throw Error('missing '+${JSON.stringify(text)});e.click()})()`)
const waitFor = async (expression, count = 100) => { for (let i=0;i<count;i++) { if (await ev(expression)) return; await sleep(250) } throw Error('Timed out: '+expression) }
const select = (label, value) => ev(`(()=>{const label=[...document.querySelectorAll('label')].find(e=>e.textContent.includes(${JSON.stringify(label)}));const e=label?.querySelector('select')??document.getElementById(label?.htmlFor);if(!e)throw Error('missing select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
try {
  let target
  for (let i=0;i<100;i++) { try { target=(await(await fetch('http://127.0.0.1:9467/json/list')).json()).find(item=>item.type==='page');if(target)break } catch { /* startup */ } await sleep(200) }
  assert.ok(target);socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data),task=pending.get(message.id);if(task){pending.delete(message.id);if(message.error)task.reject(Error(message.error.message));else task.resolve(message.result)}})
  await cmd('Runtime.enable');await waitFor('!!window.__TAURI_INTERNALS__?.invoke')
  const projectPath=resolve(run,'project')
  await call('create_project',{input:{path:projectPath,title:'Codex 兼容验收',author:'',genre:'',description:'',targetWords:1000}})
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{path:projectPath,title:'Codex 兼容验收',updatedAt:''}]))});location.reload()`)
  await sleep(800); await waitFor(`!!document.querySelector('.recent-project')`); await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.cm-content')`)
  await ev(`(()=>{const e=[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('AI 辅助'));if(!e)throw Error('AI nav missing');e.closest('details')?.setAttribute('open','');e.click()})()`)
  await waitFor(`!document.querySelector('.ai-host').hidden`)
  await ev('window.codexNavigationCalls=[]')
  await cmd('Debugger.enable')
  const invokeFunction=await cmd('Runtime.evaluate',{expression:'window.__TAURI_INTERNALS__.invoke'})
  await cmd('Debugger.setBreakpointOnFunctionCall',{objectId:invokeFunction.result.objectId,condition:"(['codex_status','codex_check_cancel'].includes(arguments[0]) && window.codexNavigationCalls.push(arguments[0]), false)"})
  const navigate = async label => {
    await ev(`(()=>{const e=[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw Error('missing navigation');e.closest('details')?.setAttribute('open','');e.click()})()`)
    await sleep(150)
  }
  await select('AI 模式','codex')
  await click('检查连接 / 刷新登录')
  await navigate('正文')
  await waitFor(`document.querySelector('.ai-host').hidden`)
  await navigate('AI 辅助')
  await click('连接设置')
  await waitFor(`document.querySelector('.codex-connection-status') && ![...document.querySelectorAll('button')].some(e=>e.textContent==='取消检查')`,400)
  const statusText=await ev(`document.querySelector('.codex-connection-status').textContent`)
  assert.ok(statusText.includes('CLI 0.153.4'),statusText)
  assert.ok(statusText.includes('ChatGPT 已登录'),statusText)
  assert.ok(statusText.includes('兼容检查通过'),statusText)
  assert.equal(await ev(`[...document.querySelectorAll('button')].find(e=>e.textContent==='运行辅助').disabled`),false)
  await click('关闭')
  for (const destination of ['总览', '正文', '项目设置']) {
    await navigate(destination);await waitFor(`document.querySelector('.ai-host').hidden`)
    await navigate('AI 辅助')
    await waitFor(`document.querySelector('.ai-codex-inline .ai-connection-state')?.textContent==='已连接'`)
    assert.equal(await ev(`[...document.querySelectorAll('button')].find(e=>e.textContent==='运行辅助').disabled`),false)
  }
  await select('AI 模式','offline');await select('AI 模式','codex')
  await waitFor(`document.querySelector('.ai-codex-inline .ai-connection-state')?.textContent==='已连接'`)
  assert.deepEqual(await ev('window.codexNavigationCalls'),['codex_status'])
  await click('连接设置')
  await click('检查连接 / 刷新登录')
  await waitFor(`document.querySelector('.codex-connection-status').textContent.includes('使用有效验证缓存') && ![...document.querySelectorAll('button')].some(e=>e.textContent==='取消检查')`,400)
  for (const width of [1440,1100]) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
    await ev(`document.querySelector('.ai-connection-dialog .modal-card').scrollIntoView({block:'start'})`); await sleep(250)
    assert.equal(await ev('document.documentElement.scrollWidth > innerWidth + 1'),false)
    const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,`codex-${width}.png`),Buffer.from(shot.data,'base64'))
  }
  await click('重新验证');await waitFor(`[...document.querySelectorAll('button')].some(e=>e.textContent==='取消检查')`)
  await click('取消检查');await waitFor(`document.querySelector('.ai-view [role="alert"]')?.textContent.includes('取消')`)
  assert.equal(await ev(`[...document.querySelectorAll('button')].find(e=>e.textContent==='运行辅助').disabled`),true)
  writeFileSync(resolve(run,'result.json'),JSON.stringify({status:statusText,result:'CODEX_COMPATIBILITY_UI_PASS',subscriptionGeneration:false,navigationPreserved:true},null,2))
  console.log('CODEX_COMPATIBILITY_UI_PASS '+run)
} finally {
  socket?.close(); child.kill()
}

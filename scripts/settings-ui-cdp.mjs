/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/settings-ui-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve('src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9462' } })
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
  for (let i = 0; i < 100; i++) { try { target = (await (await fetch('http://127.0.0.1:9462/json/list')).json()).find(item => item.type === 'page'); if (target) break } catch { /* WebView starts asynchronously. */ } await sleep(200) }
  assert.ok(target, 'CDP target starts')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  socket.addEventListener('message', event => { const message = JSON.parse(event.data), task = pending.get(message.id); if (task) { pending.delete(message.id); if (message.error) task.reject(Error(message.error.message)); else task.resolve(message.result) } })
  await cmd('Runtime.enable')
  await waitFor(`!!window.__TAURI_INTERNALS__?.invoke`)
  const projectPath = resolve(run, 'project')
  await call('create_project', { input: { path: projectPath, title: '设置布局验收', author: '', genre: '', description: '', targetWords: 1000 } })
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{path:projectPath,title:'设置布局验收',updatedAt:''}]))});location.reload()`)
  await sleep(700);await waitFor(`!!document.querySelector('.recent-project')`)
  await ev(`document.querySelector('.recent-project').click()`);await waitFor(`!!document.querySelector('.app-shell')`)
  await ev(`document.querySelector('.topbar button[aria-label="项目设置"]').click()`)
  await waitFor(`!!document.querySelector('.settings-view')`)
  const tab=async id=>{await ev(`document.querySelector('#settings-tab-${id}').click()`);await sleep(100)}
  const resize=async(width,height)=>{await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(320)}
  const metrics=[]
  async function capture(label){
    const value=await ev(`(()=>{const v=document.querySelector('.settings-view'),r=v.getBoundingClientRect();return {width:innerWidth,workspace:r.width,scroll:v.scrollHeight,height:v.clientHeight,overflow:[...v.querySelectorAll('input,select,textarea,button')].filter(e=>e.getClientRects().length&&!e.closest('.settings-nav')).filter(e=>{const b=e.getBoundingClientRect();return b.left<r.left-1||b.right>r.right+1}).map(e=>e.getAttribute('aria-label')||e.textContent)}})()`)
    metrics.push({label,...value});assert.deepEqual(value.overflow,[],label+' overflow');assert.ok(value.scroll<=value.height+1,label+' outer page scroll')
    const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,label+'.png'),Buffer.from(shot.data,'base64'))
  }
  await resize(1920,1080)
  await field('#settings-project input','分类切换保留草稿')
  await tab('writing');await field('.checklist-template-settings textarea','检查人物动机\n检查结尾悬念')
  await tab('editor');await tab('writing')
  assert.equal(await ev(`document.querySelector('.checklist-template-settings textarea').value`),'检查人物动机\n检查结尾悬念')
  await tab('project');assert.equal(await ev(`document.querySelector('#settings-project input').value`),'分类切换保留草稿')
  await ev(`document.querySelector('.settings-scroll').scrollTop=10000`)
  assert.ok(await ev(`(()=>{const r=document.querySelector('.settings-savebar').getBoundingClientRect();return r.top>0&&r.bottom<innerHeight})()`))
  await click('保存作品信息');await waitFor(`document.querySelector('.settings-savebar').textContent.includes('作品信息已保存')`)
  await tab('editor')
  await field('input[aria-label="编辑字号数值"]','18');await ev(`document.querySelector('input[aria-label="编辑字号数值"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`)
  await waitFor(`getComputedStyle(document.querySelector('.settings-reading-preview')).fontSize==='18px'`)
  assert.ok(await ev(`document.querySelector('.settings-preview-column').getBoundingClientRect().left>document.querySelector('.settings-editor-controls').getBoundingClientRect().right`))
  await capture('editor-wide')
  await ev(`document.querySelector('#settings-editor .settings-section-heading button').click()`)
  await waitFor(`getComputedStyle(document.querySelector('.settings-reading-preview')).fontSize==='14px'`)
  for(const width of [1920,1440,1100]){
    await resize(width,900)
    for(const id of ['project','appearance','editor','writing','data']){
      await tab(id);await capture(id+'-'+width)
    }
  }
  await tab('data');assert.equal(await ev(`!!document.querySelector('.settings-log')`),false)
  await ev(`document.querySelector('.settings-logs summary').click()`)
  await waitFor(`!!document.querySelector('.settings-log')&&!document.querySelector('.settings-log').textContent.includes('正在读取')`)
  await click('刷新日志');await waitFor(`!document.querySelector('.settings-log').textContent.includes('正在读取')`)
  await capture('logs-narrow')
  await tab('appearance');await click('深色');await resize(1920,1080);await capture('appearance-dark')
  await tab('editor');await capture('editor-dark')
  await tab('project');await field('#settings-project input','设置布局验收');await click('保存作品信息')
  await waitFor(`document.querySelector('.settings-savebar').textContent.includes('作品信息已保存')`)
  writeFileSync(resolve(run,'metrics.json'),JSON.stringify(metrics,null,2));console.log('SETTINGS_UI_PASS',run)
} finally { socket?.close(); child.kill() }
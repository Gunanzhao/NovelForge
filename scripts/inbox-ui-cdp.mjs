/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/inbox-ui-' + Date.now())
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
  await call('create_project', { input: { path: projectPath, title: '灵感箱布局验收', author: '', genre: '', description: '', targetWords: 1000 } })
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{path:projectPath,title:'灵感箱布局验收',updatedAt:''}]))});location.reload()`)
  await sleep(700)
  await waitFor(`!!document.querySelector('.recent-project')`)
  await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.app-shell')`)
  const nav = async () => { await ev(`(()=>{const b=[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('灵感箱'));b.closest('details')?.setAttribute('open','');b.click()})()`);await waitFor(`!!document.querySelector('.inbox-view')`) }
  const metrics=[]
  const capture=async label=>{
    const value=await ev(`(()=>{const v=document.querySelector('.inbox-view'),r=v.getBoundingClientRect();return {width:innerWidth,workspace:r.width,scroll:v.scrollHeight,height:v.clientHeight,overflow:[...v.querySelectorAll('button,input,select')].filter(e=>e.getClientRects().length).filter(e=>{const b=e.getBoundingClientRect();return b.left<r.left-1||b.right>r.right+1}).map(e=>e.textContent||e.getAttribute('aria-label'))}})()`)
    metrics.push({label,...value});assert.deepEqual(value.overflow,[],label+' horizontal overflow');assert.ok(value.scroll<=value.height+1,label+' page overflow')
    const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,label+'.png'),Buffer.from(shot.data,'base64'))
  }
  const resize=async(width,height)=>{await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(320)}
  await resize(1920,1080);await nav()
  assert.equal(await ev(`!!document.querySelector('.inbox-layout')`),false)
  await capture('empty-wide')
  await ev(`document.querySelector('.inbox-first-empty button').click()`)
  await waitFor(`!!document.querySelector('.inbox-capture-form')`)
  await field('.inbox-capture-form input','雨夜的旧车站')
  await field('.inbox-capture-form textarea','末班列车停靠时，站台上的钟倒着走了一分钟。\n她发现车票背面，是二十年前自己的笔迹。')
  await ev(`[...document.querySelectorAll('.inbox-capture-form input')].at(-1).value='悬疑'`)
  await click('保存灵感');await waitFor(`!!document.querySelector('.inbox-list button')`)
  for(let i=0;i<18;i++) await call('upsert_entity',{input:{projectPath,kind:'inbox',title:['玻璃城的守夜人','一封没有署名的信','失去名字的渡口'][i%3]+' · '+(i+1),content:{content:('在黎明之前，守夜人必须决定是否打开那扇门。\n每个人都记得城里曾有一座灯塔，却没有人记得它的位置。\n').repeat(i===17?50:1),processed:false},tags:['人物','悬疑']}})
  await click('关闭');await waitFor(`!!document.querySelector('.recent-project')`);await ev(`document.querySelector('.recent-project').click()`);await waitFor(`!!document.querySelector('.app-shell')`);await nav()
  await waitFor(`document.querySelectorAll('.inbox-list button').length===19`)
  assert.equal(await ev(`getComputedStyle(document.querySelector('.inbox-detail')).display`),'flex')
  assert.ok(await ev(`document.querySelector('.inbox-list').scrollHeight>document.querySelector('.inbox-list').clientHeight`))
  assert.ok(await ev(`document.querySelector('.inbox-detail-scroll').scrollHeight>document.querySelector('.inbox-detail-scroll').clientHeight`))
  await capture('populated-wide')
  await field('input[aria-label="搜索灵感"]','完全不匹配')
  await waitFor(`!document.querySelector('.inbox-detail')`);await capture('no-results')
  await click('清除筛选');await waitFor(`!!document.querySelector('.inbox-detail')`)
  for(const width of [1440,1100]){
    await resize(width,750)
    assert.equal(await ev(`getComputedStyle(document.querySelector('.inbox-detail')).display`),'none')
    await capture('list-'+width)
    await ev(`document.querySelector('.inbox-list button').click()`)
    await waitFor(`getComputedStyle(document.querySelector('.inbox-detail')).display==='flex'`)
    await capture('detail-'+width)
    await click('返回列表');await waitFor(`getComputedStyle(document.querySelector('.inbox-detail')).display==='none'`)
  }
  await resize(1920,1080)
  await field('input[aria-label="搜索灵感"]','雨夜')
  await waitFor(`document.querySelectorAll('.inbox-list button').length===1`)
  await ev(`(()=>{const e=document.querySelector('select[aria-label="整理目标"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'foreshadowing');e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await click('整理为资料');await waitFor(`!document.querySelector('.inbox-detail')`)
  await click('清除筛选')
  await ev(`[...document.querySelectorAll('.planning-tabs button')].find(b=>b.textContent.startsWith('已整理')).click()`)
  await waitFor(`document.querySelector('.inbox-processed')?.textContent.includes('已整理为伏笔')`)
  await capture('converted')
  await ev(`document.documentElement.dataset.theme='dark'`);await capture('dark-wide')
  writeFileSync(resolve(run,'metrics.json'),JSON.stringify(metrics,null,2))
  console.log('INBOX_UI_PASS',run)
} finally { socket?.close(); child.kill() }
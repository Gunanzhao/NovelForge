/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/ledger-ui-' + Date.now())
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
  const project = await call('create_project', { input: { path: projectPath, title: '时间线与伏笔布局验证', author: '', genre: '', description: '', targetWords: 1000 } })
  for (const [kind,title,content] of [['character','林月',{personality:'谨慎而好奇',background:'来自海边的小镇'}],['location','雾港',{description:'常年笼罩薄雾的港口'}],['world','潮汐历法',{summary:'以潮汐记录年月'}],['story-arc','寻找旧灯塔',{status:'active',chapterIds:[],milestones:[]}],['inbox','海潮带来的信',{body:'一封没有署名的信',status:'unprocessed'}]]) await call('upsert_entity',{input:{projectPath,kind,title,content,tags:['合成验证']}})
  const source = resolve(run,'reference.txt'); writeFileSync(source,'Synthetic reference')
  await call('import_attachment',{input:{projectPath,sourcePath:source,description:'用于界面验证的合成附件'}})
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path: projectPath, title: '时间线与伏笔布局验证', updatedAt: '' }]))});location.reload()`)
  await sleep(900)
  await waitFor(`!!document.querySelector('.recent-project')`)
  await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.app-shell')`)
  await ev(`[...document.querySelectorAll('.tree-row button[title="展开"]')].forEach(button=>button.click())`)
  await sleep(200)
  await ev(`(()=>{const e=[...document.querySelectorAll('.tree-row')].find(e=>e.textContent.includes(${JSON.stringify(project.nodes.find(node => node.kind === 'chapter').title)}));e.click()})()`)
  await waitFor(`!!document.querySelector('.name-generator-entry')`)
  const metrics = []
  const nav = async label => { await ev(`(()=>{const button=[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}));if(!button)throw Error('Missing navigation');button.closest('details')?.setAttribute('open','');button.click()})()`); await sleep(220) }
  async function capture(label) {
    const value = await ev(`(()=>{const main=document.querySelector('main'),r=main.getBoundingClientRect();const controls=[...main.querySelectorAll('button,input,select,textarea')].filter(e=>e.getClientRects().length&&!e.closest('details:not([open])'));return {width:innerWidth,height:innerHeight,body:document.body.scrollWidth,workspace:r.width,overflow:controls.filter(e=>{const f=e.getBoundingClientRect();return f.left<r.left-1||f.right>r.right+1}).map(e=>(e.getAttribute('aria-label')||e.textContent||e.placeholder).slice(0,50))}})()`)
    metrics.push({label,...value})
    const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,label+'.png'),Buffer.from(shot.data,'base64'))
    assert.ok(value.body<=value.width,label+' body overflow');assert.deepEqual(value.overflow,[],label+' controls overflow')
  }

  for (const [label,id,noun,placeholder] of [['时间线','timeline','事件','例如：雾港第一次停电'],['伏笔','foreshadow','伏笔','例如：钟楼里缺失的第十三口钟']]) {
    for (const width of [1648,1100]) {
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await nav(label); await capture(id+'-empty-'+width);
      assert.equal(await ev("document.querySelectorAll('.ledger-empty').length"),1);
      assert.equal(await ev("document.querySelectorAll('.special-layout').length"),0);
    }
    await click('新建'+noun);await sleep(150);
    assert.ok(await ev("!!document.querySelector('.ledger-create-layout')"));
    await field('input[placeholder="'+placeholder+'"]','合成'+noun);
    await capture(id+'-create');
    await click('保存'+noun);await waitFor("!!document.querySelector('.special-list-item')");
    for (const width of [1648,1100]) {
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await sleep(150);await capture(id+'-filled-'+width);
      if(id==='foreshadow' && width===1100) assert.equal(await ev("getComputedStyle(document.querySelector('.foreshadowing-status-bar')).gridTemplateColumns.split(' ').length"),3);
      if(id==='timeline') assert.ok(await ev("(()=>{const a=document.querySelector('input[placeholder=\"例如：2026-08-29 / 第三日\"]').getBoundingClientRect(),b=document.querySelector('input[placeholder=\"例如：深夜、黎明\"]').getBoundingClientRect();return Math.abs(a.top-b.top)<1||Math.abs(a.left-b.left)<1})()"),'Date and time align in columns or stack');
    }
    await field('.special-search input','无匹配的搜索');await sleep(150);
    assert.ok(await ev("document.querySelector('.special-list').textContent.includes('没有匹配')"));
    await click('清除筛选');await sleep(150);
    assert.ok(await ev("!!document.querySelector('.special-list-item')"));
  }
  await nav('项目设置');await ev("[...document.querySelectorAll('.theme-buttons button')].find(e=>e.textContent==='深色').click()");
  for(const label of ['时间线','伏笔']){await nav(label);await capture(label+'-dark')}
  writeFileSync(resolve(run,'metrics.json'),JSON.stringify(metrics,null,2));
  console.log('LEDGER_UI_PASS',run);
} finally { socket?.close(); child.kill() }

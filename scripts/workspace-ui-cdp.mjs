/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/workspace-ui-' + Date.now())
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
  const project = await call('create_project', { input: { path: projectPath, title: '名字工具合成验证', author: '', genre: '', description: '', targetWords: 1000 } })
  for (const [kind,title,content] of [['character','林月',{personality:'谨慎而好奇',background:'来自海边的小镇'}],['location','雾港',{description:'常年笼罩薄雾的港口'}],['world','潮汐历法',{summary:'以潮汐记录年月'}],['timeline','启航',{storyDate:'第一日',chapterId:project.nodes.find(n=>n.kind==='chapter').id}],['foreshadowing','缺页的航海日志',{status:'planted'}],['story-arc','寻找旧灯塔',{status:'active',chapterIds:[],milestones:[]}],['inbox','海潮带来的信',{body:'一封没有署名的信',status:'unprocessed'}]]) await call('upsert_entity',{input:{projectPath,kind,title,content,tags:['合成验证']}})
  const source = resolve(run,'reference.txt'); writeFileSync(source,'Synthetic reference')
  await call('import_attachment',{input:{projectPath,sourcePath:source,description:'用于界面验证的合成附件'}})
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path: projectPath, title: '名字工具合成验证', updatedAt: '' }]))});location.reload()`)
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
    const value = await ev(`(()=>{const main=document.querySelector('.ai-host-full:not([hidden])')??document.querySelector('main'),r=main.getBoundingClientRect();const controls=[...main.querySelectorAll('button,input,select,textarea')].filter(e=>e.getClientRects().length&&!e.closest('details:not([open])'));return {width:innerWidth,height:innerHeight,body:document.body.scrollWidth,workspace:r.width,overflow:controls.filter(e=>{const f=e.getBoundingClientRect();return f.left<r.left-1||f.right>r.right+1}).map(e=>(e.getAttribute('aria-label')||e.textContent||e.placeholder).slice(0,50))}})()`)
    metrics.push({label,...value})
    const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,label+'.png'),Buffer.from(shot.data,'base64'))
    assert.ok(value.body<=value.width,label+' body overflow');assert.deepEqual(value.overflow,[],label+' controls overflow')
  }
  for (const [width,height] of [[1440,900],[1100,650]]) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
    for (const [label,id] of [['总览','dashboard'],['正文','manuscript'],['人物','character'],['地点','location'],['世界观','world'],['时间线','timeline'],['伏笔','foreshadow'],['剧情线','arc'],['灵感箱','inbox'],['资料附件','attachment'],['AI 辅助','ai'],['全文搜索','search'],['项目设置','settings']]) {
      await nav(label)
      if(['character','location','world','timeline','arc','inbox','attachment'].includes(id)) { await ev(`document.querySelector('main .entity-list-item,main button.special-list-item,main .story-arc-list-item,main .inbox-list button,main .attachment-list-item')?.click()`); await sleep(120) }
      await capture(id+'-'+width)
    }
  }
  await nav('人物')
  await ev(`document.querySelector('.entity-list-item').click()`)
  await field('input[placeholder="输入人物名称"]','林月（草稿）')
  await ev(`document.querySelector('.entity-field-group.disclosure summary').click()`)
  assert.equal(await ev(`document.querySelector('input[placeholder="输入人物名称"]').value`),'林月（草稿）')
  await ev(`document.querySelector('.entity-view').scrollTop=500`)
  await sleep(100)
  assert.ok(await ev(`(()=>{const r=document.querySelector('.entity-save-bar').getBoundingClientRect();return r.top>=54&&r.bottom<innerHeight})()`),'Save bar remains visible')
  await field('input[placeholder="输入人物名称"]','林月')
  await nav('项目设置')
  await click('外观与布局')
  await click('深色')
  await sleep(100);await capture('settings-dark')
  await click('编辑器')
  await field('#settings-editor input[type=range][aria-label=编辑字号]','18')
  assert.equal(await ev(`getComputedStyle(document.querySelector('.settings-reading-preview')).fontSize`),'18px')
  await ev(`document.querySelector('.settings-reading-preview').scrollIntoView({block:'center'})`)
  await sleep(200);await capture('settings-preview-dark')
  await ev(`document.querySelector('#settings-editor .settings-section-heading button').click()`)
  assert.equal(await ev(`getComputedStyle(document.querySelector('.settings-reading-preview')).fontSize`),'14px')
  await nav('AI 辅助');await capture('ai-dark')
  assert.ok(await ev(`document.querySelector('.ai-host-full').getBoundingClientRect().height>0`))
  assert.equal(await ev(`document.querySelectorAll('.ai-connection-dialog [role=dialog]').length`),0)
  await nav('正文')
  await ev(`[...document.querySelectorAll('.topbar button')].find(e=>e.textContent.trim()==='导出').click()`)
  await waitFor(`!!document.querySelector('.export-summary')`)
  await ev(`[...document.querySelectorAll('.export-option')].find(e=>e.textContent.includes('纯文本 TXT')).click()`)
  assert.ok(await ev(`document.querySelector('.export-summary').textContent.includes('1 章')`))
  const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,'export-dark.png'),Buffer.from(shot.data,'base64'))
  await click('导出 纯文本 TXT');await waitFor(`!document.querySelector('.modal-card')`)
  assert.ok(readdirSync(resolve(projectPath, '.novelforge/exports')).some(name => name.endsWith('.txt')), 'TXT export exists on disk')
  writeFileSync(resolve(run,'metrics.json'),JSON.stringify(metrics,null,2))
  console.log('WORKSPACE_UI_PASS',run)
} finally { socket?.close(); child.kill() }

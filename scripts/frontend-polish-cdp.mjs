/* global console, process, fetch, WebSocket, setTimeout, Buffer */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// UI acceptance uses synthetic data and an isolated profile. Desktop mode uses
// the real production dispatcher; browser mode is for quick layout iteration.
const desktop = process.argv[2] !== '--browser'
const executable = desktop ? resolve(process.argv[2] ?? 'src-tauri/target/release/novelforge.exe') : undefined
const out = resolve(process.env.NOVELFORGE_UI_OUTPUT ?? 'tmp/frontend-polish-ui')
mkdirSync(out, { recursive: true })
const temp = mkdtempSync(join(tmpdir(), 'novelforge-ui-'))
for (const name of ['profile', 'appdata', 'localappdata', 'project']) mkdirSync(join(temp, name))
const port = 9479, serverPort = 1439
const delay = ms => new Promise(r => setTimeout(r, ms))
let child, server, socket
const errors = [], rows = []
try {
  if (!desktop) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], { windowsHide: true, stdio: 'ignore' })
    for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${serverPort}`)).ok) break } catch { /* bounded startup */ } await delay(100) }
  }
  const env = { ...process.env, APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata') }
  delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS; delete env.WEBVIEW2_USER_DATA_FOLDER
  child = spawn(desktop ? executable : 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', desktop ? ['--diagnostic-webview', String(port), join(temp, 'profile')] : ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, '--user-data-dir=' + join(temp, 'profile'), `http://127.0.0.1:${serverPort}`], { windowsHide: true, stdio: 'ignore', env })
  let page
  for (let i = 0; i < 160; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page' && (!desktop || p.url.startsWith('http://tauri.localhost'))) } catch { /* bounded startup */ } if (page) break; await delay(250) }
  assert.ok(page, 'production WebView/browser is available')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((yes, no) => { socket.addEventListener('open', yes, { once: true }); socket.addEventListener('error', no, { once: true }) })
  let id = 0; const pending = new Map()
  socket.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); const p = pending.get(m.id); if (p) { pending.delete(m.id); if (m.error) p.reject(Error(m.error.message)); else p.resolve(m.result) } })
  const cmd = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); socket.send(JSON.stringify({ id: n, method, params })) })
  const ev = async expression => { const r = await cmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.equal(r.exceptionDetails, undefined, JSON.stringify(r.exceptionDetails)); return r.result.value }
  const wait = async expression => { for (let i = 0; i < 100; i++) { if (await ev(expression)) return; await delay(100) } throw Error('UI timeout: ' + expression) }
  const click = async (selector, label) => {
    await ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.querySelector('span')?.textContent===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!e)throw Error('Missing action: '+${JSON.stringify(label)});let parent=e.tagName==='SUMMARY'?e.parentElement?.parentElement:e.parentElement;while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement}e.scrollIntoView({block:'nearest'});e.click()})()`)
    await delay(180)
  }
  const capture = async name => { await delay(150); writeFileSync(join(out, name + '.png'), Buffer.from((await cmd('Page.captureScreenshot', { format: 'png' })).data, 'base64')) }
  await cmd('Runtime.enable')
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await wait('!!document.querySelector(".welcome")'); await capture('welcome')
  const title = '长夜归途：穿过旧城与群山之后的最后一封来信'
  const body = '雨停在黄昏之前。\n\n林舟推开旧书店的门，铜铃轻轻响了一声。柜台后的老人抬起头，仿佛已经等了他很多年。\n\n“你终于来了。”老人说。\n\n街道尽头，最后一盏路灯亮了起来。'
  if (desktop) {
    const invoke = (command, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`)
    const path = join(temp, 'project')
    const data = await invoke('create_project', { input: { path, title, author: '界面验收示例', genre: '奇幻', description: '一名旅人穿过旧城，寻找消失在长夜里的故乡。', targetWords: 300000 } })
    const chapter = data.nodes.find(n => n.kind === 'chapter')
    const original = await invoke('get_document', { input: { projectPath: path, nodeId: chapter.id } })
    await invoke('save_document_annotated', { input: { projectPath: path, nodeId: chapter.id, content: body, reason: '界面验收夹具' }, expectedContent: original.content, annotationAnchors: null })
    await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path, title, updatedAt: new Date().toISOString() }]))})`)
    await cmd('Page.reload'); await wait('!!document.querySelector(".recent-project")'); await ev('document.querySelector(".recent-project").click()')
  } else {
    await ev(`(async()=>{window.uiStore=(await import('/src/stores/app-store.ts')).useAppStore;await uiStore.getState().createProject(${JSON.stringify({ path: 'ui-synthetic', title, author: '', genre: '', description: '', targetWords: 300000 })});uiStore.getState().updateContent(${JSON.stringify(body)});await uiStore.getState().saveCurrentDocument('自动保存')})()`)
  }
  await wait('!!document.querySelector(".cm-content")')
  const views = [['正文', '.manuscript-view'], ['总览', '.dashboard-grid'], ['人物', '.entity-view'], ['写作规划', '.planning-view'], ['章节记忆', '.chapter-memory-view'], ['稿件导入', '.manuscript-import-view'], ['批注与修订', '.annotation-tasks'], ['灵感箱', '.inbox-view'], ['时间线', '.workspace'], ['剧情线', '.story-arc-view'], ['AI 辅助', '.ai-host-full'], ['项目设置', '.settings-view']]
  for (const width of [1024, 1440, 1920]) for (const theme of ['light', 'dark']) {
    await cmd('Emulation.setDeviceMetricsOverride', { width, height: width === 1024 ? 768 : 900, deviceScaleFactor: 1, mobile: false })
    if (await ev('document.documentElement.dataset.theme') !== theme) await click('button', '切换主题')
    for (const [view, selector] of views) {
      await click('.nav-item', view); await wait(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`)
      await delay(230)
      const geometry = await ev(`(()=>{const root=document.querySelector('.workspace:not([hidden])')||document.querySelector('.ai-host-full');const r=root.getBoundingClientRect();const bad=[...root.querySelectorAll('input,textarea,select,button,h1')].filter(e=>e.checkVisibility()).filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.left<r.left-2||b.right>r.right+2)}).map(e=>({tag:e.tagName,label:e.getAttribute('aria-label')||e.textContent.slice(0,45)}));return {width:r.width,overflow:root.scrollWidth>root.clientWidth+1,bad}})()`)
      const name = `${width}-${theme}-${view}`
      await capture(name); rows.push({ view, width, theme, ...geometry })
      assert.equal(geometry.overflow, false, name + ': work area overflow')
      assert.deepEqual(geometry.bad, [], name + ': controls outside work area')
    }
    await click('[role=tab]', '数据与日志'); await capture(`${width}-${theme}-数据与恢复`)
    if (desktop) {
      await ev('document.querySelector(".settings-scroll").scrollTop=99999'); await capture(`${width}-${theme}-恢复工具`)
    }
  }
  // Narrow drawers must retain mounted editors, navigation pins and entered AI instructions.
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1.25, mobile: false })
  await click('.nav-item', '正文')
  assert.ok(await ev('document.querySelector(".workspace").getBoundingClientRect().width>=740'))
  await click('button', '展开辅助栏'); await wait('document.querySelector(".inspector-drawer")?.checkVisibility()'); await capture('narrow-drawer-125-percent')
  await ev('window.retainedInspector=document.querySelector(".inspector");undefined')
  await click('button', '关闭章节辅助'); await click('button', '展开辅助栏')
  assert.ok(await ev('window.retainedInspector===document.querySelector(".inspector")'))
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await delay(150)
  assert.equal(await ev('document.querySelector(".inspector-region").checkVisibility()'), false)
  await click('.editor-toolbar button', 'AI 辅助'); await wait('document.querySelector(".ai-host-drawer")?.checkVisibility()')
  await ev(`(()=>{const input=document.querySelector('.ai-instruction-input');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'保留这份尚未提交的要求');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('.ai-inline-nav button', '收起'); await click('.editor-toolbar button', 'AI 辅助')
  assert.equal(await ev('document.querySelector(".ai-instruction-input").value'), '保留这份尚未提交的要求')
  await click('.ai-inline-nav button', '收起')
  await click('summary', '更多格式'); assert.ok(await ev('document.querySelector(".editor-toolbar .action-menu").open'))
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await delay(100)
  assert.equal(await ev('document.querySelector(".editor-toolbar .action-menu").open'), false)
  assert.ok(await ev('document.activeElement===document.querySelector(".editor-toolbar .action-menu summary")'))
  assert.ok(await ev('document.querySelector(".statusbar").textContent.includes("76 字")'))
  assert.equal(await ev('document.querySelector(".editor-subbar")!==null'), false)
  await click('button', '固定时间线'); await wait('!!document.querySelector(".pinned-navigation")')
  await cmd('Page.reload'); await wait('!!document.querySelector(".recent-project")'); await ev('document.querySelector(".recent-project").click()'); await wait('!!document.querySelector(".pinned-navigation")')
  assert.ok(await ev('document.querySelector(".pinned-navigation").textContent.includes("时间线")'))
  assert.deepEqual(errors, [], 'uncaught runtime errors')
  writeFileSync(join(out, 'result.json'), JSON.stringify({ desktop, rows, assertions: ['drawer preserves mounted content', 'AI instruction retained', 'menu Escape and focus', 'consistent word count', 'navigation pin survives reload'], errors }, null, 2))
  console.log(`PASS: ${rows.length} rendered layouts; drawers, menus, retained drafts, word count and persistent navigation; desktop=${desktop}`)
} finally {
  writeFileSync(join(out, 'layout-progress.json'), JSON.stringify({ rows, errors }, null, 2))
  socket?.close()
  for (const proc of [child, server]) if (proc?.pid) try { execFileSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* already exited */ }
}

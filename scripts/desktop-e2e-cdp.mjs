/* global console, fetch, process, setTimeout, WebSocket */

import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'src-tauri/target/release/novelforge.exe')
const port = Number(process.env.NOVELFORGE_E2E_PORT ?? 9223)
const profile = resolve(tmpdir(), 'novelforge-e2e-' + process.pid)
const webdriverMode = process.env.NOVELFORGE_E2E_WEBDRIVER === '1'
const webdriverPort = Number(process.env.NOVELFORGE_WEBDRIVER_PORT ?? 4467)
const nativeDriverPort = Number(process.env.NOVELFORGE_NATIVE_DRIVER_PORT ?? 4468)
const nativeDialogScript = resolve(root, 'scripts/desktop-dialog-uia.ps1')
const nativeDialogMode = process.env.NOVELFORGE_E2E_NATIVE_DIALOGS === '1'
const coverMode = process.env.NOVELFORGE_E2E_COVER === '1'
const keepProject = process.env.NOVELFORGE_E2E_KEEP_PROJECT === '1'
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

if (!existsSync(executable)) throw new Error('release EXE 不存在：' + executable)

function findNativeDriver() {
  const configured = process.env.EDGE_DRIVER_PATH
  if (configured && existsSync(configured)) return resolve(configured)
  const candidates = []
  const addCandidate = (value) => {
    if (value && existsSync(value) && !candidates.includes(value)) candidates.push(value)
  }
  const pathCandidates = process.env.PATH?.split(';') ?? []
  for (const directory of pathCandidates) addCandidate(resolve(directory, 'msedgedriver.exe'))
  const packageRoot = resolve(process.env.LOCALAPPDATA ?? '', 'Microsoft/WinGet/Packages')
  const walk = (directory, depth) => {
    if (!directory || depth > 3 || !existsSync(directory)) return
    let entries = []
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const child = resolve(directory, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === 'msedgedriver.exe') addCandidate(child)
      else if (entry.isDirectory()) walk(child, depth + 1)
    }
  }
  walk(packageRoot, 0)
  const preferredVersion = process.env.NOVELFORGE_EDGE_DRIVER_VERSION
  if (preferredVersion) {
    const preferred = candidates.find((candidate) => {
      try { return execFileSync(candidate, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).includes(preferredVersion) } catch { return false }
    })
    if (preferred) return preferred
  }
  if (candidates.length) return candidates[0]
  throw new Error('未找到 msedgedriver.exe；请设置 EDGE_DRIVER_PATH 指向与 WebView2 版本匹配的官方驱动。')
}

async function waitForPage(address = '127.0.0.1:' + port) {
  const base = address.startsWith('http://') ? address : 'http://' + address
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(base + '/json/list').then((response) => response.json())
      const page = pages.find((item) => item.type === 'page' && item.url.startsWith('http://tauri.localhost'))
      if (page) return page
    } catch {
      // WebView2 调试端口尚未就绪。
    }
    await sleep(250)
  }
  throw new Error('等待 WebView2 CDP 页面超时，地址：' + address)
}

async function waitForNoPage(address = '127.0.0.1:' + port) {
  const base = address.startsWith('http://') ? address : 'http://' + address
  const deadline = Date.now() + 10_000
  let noPageChecks = 0
  while (Date.now() < deadline) {
    try {
      const pages = await fetch(base + '/json/list').then((response) => response.json())
      if (!pages.some((item) => item.type === 'page' && item.url.startsWith('http://tauri.localhost'))) {
        noPageChecks += 1
        if (noPageChecks >= 3) return
      } else {
        noPageChecks = 0
      }
    } catch {
      noPageChecks += 1
      if (noPageChecks >= 3) return
    }
    await sleep(200)
  }
  throw new Error('旧 WebView2 页面未退出：' + address)
}

function stopProcessTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      return
    } catch {
      // 进程可能已自然退出，继续走兼容的 kill。
    }
  }
  if (!child.killed) child.kill()
}

async function waitForProcessExit(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolvePromise) => child.once('exit', resolvePromise)),
    sleep(5_000),
  ])
}

class CdpPage {
  constructor(page, handleDialogs = false) {
    this.socket = new WebSocket(page.webSocketDebuggerUrl)
    this.nextId = 1
    this.pending = new Map()
    this.handleDialogs = handleDialogs
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Page.javascriptDialogOpening' && this.handleDialogs) {
        const promptText = message.params?.type === 'prompt' ? '序章' : undefined
        void this.command('Page.handleJavaScriptDialog', { accept: true, ...(promptText ? { promptText } : {}) })
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message)
    })
  }

  async connect() {
    await new Promise((resolvePromise, reject) => {
      if (this.socket.readyState === 1) {
        resolvePromise()
        return
      }
      this.socket.addEventListener('open', resolvePromise, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    await this.command('Runtime.enable')
    if (this.handleDialogs) await this.command('Page.enable')
  }

  command(method, params = {}) {
    return new Promise((resolvePromise, reject) => {
      const id = this.nextId
      this.nextId += 1
      this.pending.set(id, { resolve: resolvePromise, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const response = await this.command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (response.result?.exceptionDetails) {
      throw new Error('页面脚本异常：' + JSON.stringify(response.result.exceptionDetails))
    }
    return response.result?.result?.value
  }

  close() {
    this.socket.close()
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = { value: text } }
  if (!response.ok) throw new Error('WebDriver 请求失败 ' + response.status + '：' + JSON.stringify(payload))
  return payload
}

async function startWebDriver(resetProfile = true) {
  const driverPath = process.env.TAURI_DRIVER_PATH || resolve(homedir(), '.cargo/bin/tauri-driver.exe')
  if (!existsSync(driverPath)) throw new Error('未找到 tauri-driver.exe：' + driverPath)
  const nativeDriverPath = findNativeDriver()
  if (resetProfile) rmSync(profile, { recursive: true, force: true })
  const driver = spawn(driverPath, [
    '--port', String(webdriverPort),
    '--native-port', String(nativeDriverPort),
    '--native-driver', nativeDriverPath,
  ], {
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile },
    windowsHide: true,
    stdio: 'ignore',
  })
  const statusUrl = 'http://127.0.0.1:' + webdriverPort + '/status'
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      await requestJson(statusUrl)
      break
    } catch {
      await sleep(250)
    }
  }
  const capabilities = {
    alwaysMatch: {
      'tauri:options': { application: executable, args: [] },
    },
    firstMatch: [{}],
  }
  const session = await requestJson('http://127.0.0.1:' + webdriverPort + '/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capabilities }),
  })
  const sessionId = session?.value?.sessionId
  const debuggerAddress = session?.value?.capabilities?.['ms:edgeOptions']?.debuggerAddress
  if (!sessionId || !debuggerAddress) throw new Error('WebDriver 返回中缺少 sessionId 或 debuggerAddress：' + JSON.stringify(session))
  return { driver, sessionId, debuggerAddress }
}

function jsString(value) {
  return JSON.stringify(value)
}

async function bodyText(page) {
  return page.evaluate('document.body.innerText')
}

async function clickText(page, text) {
  const expression = "(function(){const item=Array.from(document.querySelectorAll('button')).find((button)=>(button.textContent||'').includes(" + jsString(text) + "));item?.click();return Boolean(item)})()"
  const clicked = await page.evaluate(expression)
  if (!clicked) throw new Error('找不到按钮：' + text)
}

async function clickExact(page, text) {
  const expression = "(function(){const item=Array.from(document.querySelectorAll('button')).find((button)=>(button.textContent||'').trim()===" + jsString(text) + ");item?.click();return Boolean(item)})()"
  const clicked = await page.evaluate(expression)
  if (!clicked) throw new Error('找不到精确按钮：' + text)
}

async function clickTitle(page, title) {
  const expression = "(function(){const item=Array.from(document.querySelectorAll('button')).find((button)=>button.getAttribute('title')===" + jsString(title) + ");item?.click();return Boolean(item)})()"
  const clicked = await page.evaluate(expression)
  if (!clicked) throw new Error('找不到标题按钮：' + title)
}

async function clickSelector(page, selector, text) {
  const expression = "(function(){const item=Array.from(document.querySelectorAll(" + jsString(selector) + ")).find((node)=>(node.textContent||'').trim()===" + jsString(text) + ");item?.click();return Boolean(item)})()"
  if (!await page.evaluate(expression)) throw new Error('找不到指定控件：' + selector + ' / ' + text)
}

async function clickSelectorContains(page, selector, text) {
  const expression = "(function(){const item=Array.from(document.querySelectorAll(" + jsString(selector) + ")).find((node)=>(node.textContent||'').includes(" + jsString(text) + "));item?.click();return Boolean(item)})()"
  if (!await page.evaluate(expression)) throw new Error('找不到指定控件：' + selector + ' 包含 ' + text)
}

async function rightClickAt(page, point) {
  await page.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await page.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1 })
  await page.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'right', buttons: 0, clickCount: 1 })
  await sleep(120)
}

async function rightClickSelector(page, selector, text) {
  const expression = "(function(){const item=Array.from(document.querySelectorAll(" + jsString(selector) + ")).find((node)=>" + (text ? "(node.textContent||'').includes(" + jsString(text) + ")" : 'true') + ");if(!item)return null;const rect=item.getBoundingClientRect();return {x:rect.left+Math.min(Math.max(8,rect.width/2),Math.max(8,rect.width-8)),y:rect.top+Math.min(Math.max(8,rect.height/2),Math.max(8,rect.height-8))}})()"
  const point = await page.evaluate(expression)
  if (!point) throw new Error('找不到右键目标：' + selector + (text ? ' / ' + text : ''))
  await rightClickAt(page, point)
}

async function assertCustomContextMenu(page, label) {
  await waitForSelector(page, '.context-menu[data-context-menu-surface="true"]', label + '自定义菜单')
  const result = await page.evaluate("(()=>{const menu=document.querySelector('.context-menu[data-context-menu-surface=\"true\"]');if(!menu)return null;const rect=menu.getBoundingClientRect();return {left:rect.left,top:rect.top,labels:Array.from(menu.querySelectorAll('[role=\"menuitem\"]')).map((item)=>item.textContent?.trim()).filter(Boolean)}})()")
  if (!result || result.left < 8 || result.top < 8) throw new Error(label + '菜单未完成窗口边缘避让：' + JSON.stringify(result))
  await pressEscape(page)
  await waitForCondition(page, "document.querySelector('.context-menu[data-context-menu-surface=\"true\"]') === null", label + '菜单关闭')
  return result
}

async function rowPoint(page, text) {
  const expression = "(function(){const row=Array.from(document.querySelectorAll('.tree-row')).find((item)=>(item.textContent||'').includes(" + jsString(text) + "));if(!row)return null;const rect=row.getBoundingClientRect();return {x:rect.left+Math.min(rect.width-18,Math.max(18,rect.width/2)),y:rect.top+rect.height/2}})()"
  const point = await page.evaluate(expression)
  if (!point) throw new Error('找不到正文树行：' + text)
  return point
}

async function treeRowExists(page, text) {
  return Boolean(await page.evaluate("(function(){return Array.from(document.querySelectorAll('.tree-row')).some((item)=>(item.textContent||'').includes(" + jsString(text) + "))})()"))
}

async function treeRowUnderParent(page, childText, parentText) {
  const expression = "(function(){const rows=Array.from(document.querySelectorAll('.tree-row'));const index=rows.findIndex((item)=>(item.textContent||'').includes(" + jsString(childText) + "));if(index<0)return false;const childLevel=Number.parseInt(rows[index].style.paddingLeft||'0',10);for(let cursor=index-1;cursor>=0;cursor-=1){const row=rows[cursor];const level=Number.parseInt(row.style.paddingLeft||'0',10);if(level<childLevel)return (row.textContent||'').includes(" + jsString(parentText) + ");}return false})()"
  return Boolean(await page.evaluate(expression))
}

async function ensureTreeRow(page, parentText, childText) {
  if (await treeRowUnderParent(page, childText, parentText)) return
  const expanded = await clickRowActionIfPresent(page, parentText, '展开')
  if (!expanded && !(await treeRowExists(page, parentText))) throw new Error('找不到正文树父行：' + parentText)
  await waitForText(page, childText)
}

async function ensureEditor(page, label) {
  await waitForSelector(page, '.manuscript-view', label + '正文视图')
  if (!(await page.evaluate("document.querySelector('.cm-content') !== null"))) {
    await clickExact(page, '编辑')
  }
  await waitForCondition(page, "document.querySelector('.cm-content') !== null", label + '编辑器')
}

async function dragRow(page, sourceText, targetText) {
  const source = await rowPoint(page, sourceText)
  const target = await rowPoint(page, targetText)
  await page.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: source.x, y: source.y })
  await page.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: source.x, y: source.y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(150)
  const steps = 5
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps
    await page.command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: source.x + (target.x - source.x) * ratio,
      y: source.y + (target.y - source.y) * ratio,
      button: 'left',
      buttons: 1,
    })
    await sleep(60)
  }
  await page.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(500)
  if (await treeRowUnderParent(page, sourceText, targetText)) return
  const dispatched = await page.evaluate("(function(){const rows=Array.from(document.querySelectorAll('.tree-row'));const source=rows.find((item)=>(item.textContent||'').includes(" + jsString(sourceText) + "));const target=rows.find((item)=>(item.textContent||'').includes(" + jsString(targetText) + "));if(!source||!target||typeof DataTransfer==='undefined'||typeof DragEvent==='undefined')return false;const dataTransfer=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer}));target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer}));return true})()")
  if (dispatched) await sleep(500)
}

async function clickModalButton(page, text) {
  const expression = "(function(){const item=Array.from(document.querySelectorAll('.modal-card button')).find((button)=>(button.textContent||'').trim()===" + jsString(text) + ");item?.click();return Boolean(item)})()"
  if (!await page.evaluate(expression)) throw new Error('找不到模态框按钮：' + text)
}

async function clickRowAction(page, rowText, title) {
  const expression = "(function(){const row=Array.from(document.querySelectorAll('.tree-row')).find((item)=>(item.textContent||'').includes(" + jsString(rowText) + "));const action=Array.from(row?.querySelectorAll('button')||[]).find((button)=>button.getAttribute('title')===" + jsString(title) + ");action?.click();return Boolean(action)})()"
  if (!await page.evaluate(expression)) throw new Error('找不到正文树操作：' + rowText + ' / ' + title)
}

async function clickRowActionIfPresent(page, rowText, title) {
  const expression = "(function(){const row=Array.from(document.querySelectorAll('.tree-row')).find((item)=>(item.textContent||'').includes(" + jsString(rowText) + "));const action=Array.from(row?.querySelectorAll('button')||[]).find((button)=>button.getAttribute('title')===" + jsString(title) + ");action?.click();return Boolean(action)})()"
  return Boolean(await page.evaluate(expression))
}

async function toggleRowSelection(page, rowText) {
  const expression = "(function(){const row=Array.from(document.querySelectorAll('.tree-row')).find((item)=>(item.textContent||'').includes(" + jsString(rowText) + "));const checkbox=row?.querySelector('.tree-checkbox');checkbox?.click();return Boolean(checkbox)})()"
  if (!await page.evaluate(expression)) throw new Error('找不到正文树选择框：' + rowText)
}

async function replaceEditor(page, text) {
  await page.evaluate("document.querySelector('.cm-content')?.focus(); true")
  await page.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 2, windowsVirtualKeyCode: 17 })
  await page.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await page.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await page.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', modifiers: 0, windowsVirtualKeyCode: 17 })
  await page.command('Input.insertText', { text })
}

async function selectEditorAll(page) {
  await page.evaluate("document.querySelector('.cm-content')?.focus(); true")
  await page.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 2, windowsVirtualKeyCode: 17 })
  await page.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await page.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await page.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', modifiers: 0, windowsVirtualKeyCode: 17 })
}

async function pressControlKey(page, key, code, virtualKey) {
  await page.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 2, windowsVirtualKeyCode: 17 })
  await page.command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers: 2, windowsVirtualKeyCode: virtualKey })
  await page.command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: 2, windowsVirtualKeyCode: virtualKey })
  await page.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', modifiers: 0, windowsVirtualKeyCode: 17 })
}

async function pressEscape(page) {
  await page.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}

async function setCurrentValue(page, fragment, value) {
  const expression = "(function(){const target=Array.from(document.querySelectorAll('input,textarea')).find((item)=>(item.value||'').includes(" + jsString(fragment) + "));if(!target)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(target," + jsString(value) + ");target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));return true})()"
  if (!await page.evaluate(expression)) throw new Error('找不到当前值输入框：' + fragment)
}

async function selectValue(page, selector, value) {
  const expression = "(function(){const target=document.querySelector(" + jsString(selector) + ");if(!target)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')?.set;if(!setter)return false;setter.call(target," + jsString(value) + ");target.dispatchEvent(new Event('change',{bubbles:true}));return true})()"
  if (!await page.evaluate(expression)) throw new Error('找不到选择框：' + selector)
}

async function waitForCondition(page, expression, label) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await page.evaluate('Boolean(' + expression + ')')) return
    await sleep(200)
  }
  throw new Error('条件未满足：' + label)
}

async function waitForSelector(page, selector, label) {
  await waitForCondition(page, "document.querySelector(" + jsString(selector) + ") !== null", label)
}

async function setField(page, labelOrPlaceholder, value) {
  const key = jsString(labelOrPlaceholder)
  const nextValue = jsString(value)
  const expression = "(function(){const target=Array.from(document.querySelectorAll('input,textarea')).find((item)=>(item.getAttribute('aria-label')||item.getAttribute('placeholder')||'').includes(" + key + "));if(!target)return false;const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;if(!setter)return false;setter.call(target," + nextValue + ");target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));return true})()"
  if (!await page.evaluate(expression)) throw new Error('找不到输入框：' + labelOrPlaceholder)
}

function runNativeDialogHelper(mode, title, targetPath) {
  if (!existsSync(nativeDialogScript)) throw new Error('原生对话框辅助脚本不存在：' + nativeDialogScript)
  const powershell = process.env.NOVELFORGE_POWERSHELL || 'pwsh'
  const child = spawn(powershell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', nativeDialogScript,
    '-Mode', mode, '-Path', targetPath, '-Title', title,
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  return new Promise((resolvePromise, reject) => {
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error('原生文件对话框辅助失败：' + (stderr.trim() || 'exit=' + code + ' signal=' + signal)))
    })
  })
}

async function chooseNativeDialog(page, mode, title, targetPath, triggerText = '选择') {
  const helper = runNativeDialogHelper(mode, title, targetPath)
  await sleep(150)
  await clickExact(page, triggerText)
  await helper
}

async function waitForText(page, text) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      if ((await bodyText(page)).includes(text)) return
    } catch {
      // A WebView2 navigation can briefly invalidate the execution context.
    }
    await sleep(200)
  }
  throw new Error('页面未出现文本：' + text + '\n当前页面：\n' + await bodyText(page))
}

function findManuscriptFile(directory) {
  let entries = []
  try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return null }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const child = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = findManuscriptFile(child)
      if (nested && nested.includes('\\manuscript\\')) return nested
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && directory.toLowerCase().includes('\\manuscript')) {
      return child
    }
  }
  return null
}

async function runRecoveryFlow(page, projectPath, projectTitle, restartPage) {
  const target = findManuscriptFile(projectPath)
  if (!target) throw new Error('找不到用于保存失败验收的正文文件')
  let lockProcess
  if (process.platform === 'win32') {
    const escapedTarget = target.replaceAll("'", "''")
    const lockScript = "$stream=[IO.File]::Open('" + escapedTarget + "',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{Start-Sleep -Seconds 120}finally{$stream.Dispose()}"
    lockProcess = spawn(process.env.NOVELFORGE_POWERSHELL || 'pwsh', ['-NoProfile', '-Command', lockScript], {
      windowsHide: true,
      stdio: 'ignore',
    })
    await sleep(350)
    if (lockProcess.exitCode !== null) throw new Error('无法锁定正文文件用于保存失败验收')
  }
  try {
    await replaceEditor(page, '# 第一章\n\n恢复验收内容')
    await clickExact(page, '保存')
    await waitForCondition(page, "document.body.innerText.includes('保存失败') && document.body.innerText.includes('恢复数据已保留')", '保存失败与恢复文件保留')
    const recoveryDirectory = resolve(projectPath, '.novelforge', 'recovery')
    if (!existsSync(recoveryDirectory) || !readdirSync(recoveryDirectory).some((name) => name.endsWith('.md'))) {
      throw new Error('保存失败后未生成恢复文件')
    }
  } finally {
    if (lockProcess && lockProcess.exitCode === null) lockProcess.kill()
    await sleep(150)
  }

  page = await restartPage()
  await waitForText(page, '新建小说')
  const recentProjectVisible = await page.evaluate("(function(){return Array.from(document.querySelectorAll('button')).some((button)=>(button.textContent||'').includes(" + jsString(projectTitle) + "))})()")
  if (recentProjectVisible) {
    await clickText(page, projectTitle)
  } else {
    await clickText(page, '打开项目')
    await waitForText(page, '打开小说项目')
    if (nativeDialogMode) await chooseNativeDialog(page, 'folder', '选择项目文件夹', projectPath)
    else await setField(page, '选择项目文件夹', projectPath)
    await clickModalButton(page, '打开项目')
  }
  await waitForText(page, 'MANUSCRIPT / CHAPTER')
  await clickExact(page, '总览')
  await waitForText(page, '检测到未恢复的写作内容')
  await clickExact(page, '查看')
  await waitForText(page, '恢复验收内容')
  await clickModalButton(page, '关闭')
  await clickSelector(page, '.recovery-banner button', '恢复')
  await waitForCondition(page, "document.querySelector('.recovery-banner') === null", '恢复提示清除')
  await clickExact(page, '正文')
  await ensureEditor(page, '恢复后')
  if (!readFileSync(target, 'utf8').includes('恢复验收内容')) throw new Error('恢复文件内容未写回正文')
  const recoveryDirectory = resolve(projectPath, '.novelforge', 'recovery')
  if (existsSync(recoveryDirectory) && readdirSync(recoveryDirectory).some((name) => name.endsWith('.md'))) {
    throw new Error('恢复完成后仍残留恢复文件')
  }
  await replaceEditor(page, '# 第一章\n\n[[林月]] 来到雾港。\n\n**关键线索**\n\n- 第一项\n- 第二项')
  await clickExact(page, '保存')
  await waitForText(page, '已保存')
  console.log('RECOVERY_FAILURE_OK')
}

async function waitForExport(projectPath, extension) {
  const directory = resolve(projectPath, '.novelforge', 'exports')
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (existsSync(directory) && readdirSync(directory).some((name) => name.endsWith('.' + extension))) return
    await sleep(250)
  }
  throw new Error('导出文件未出现：' + extension)
}

async function runEditorPerformanceFlow(page) {
  const baseline = '# 第一章\n\n[[林月]] 来到雾港。\n\n**关键线索**\n\n- 第一项\n- 第二项'
  const largeText = '# 大文件性能\n\n' + '中文性能测试段落。'.repeat(12_000) + '\n\n性能结尾标记'
  const replaceStarted = Date.now()
  await replaceEditor(page, largeText.slice(0, 12_000))
  for (let offset = 12_000; offset < largeText.length; offset += 12_000) {
    await page.command('Input.insertText', { text: largeText.slice(offset, offset + 12_000) })
  }
  await waitForCondition(page, "document.querySelector('.cm-content') !== null", '大文件编辑器')
  await page.evaluate("(()=>{let node=document.querySelector('.cm-content');while(node){node.scrollTop=node.scrollHeight;node=node.parentElement}if(document.scrollingElement)document.scrollingElement.scrollTop=document.scrollingElement.scrollHeight;return true})()")
  await waitForCondition(page, "document.querySelector('.cm-content')?.innerText.includes('性能结尾标记')", '大文件末尾内容')
  const replaceMs = Date.now() - replaceStarted
  const saveStarted = Date.now()
  await clickExact(page, '保存')
  await waitForText(page, '已保存')
  const saveMs = Date.now() - saveStarted
  const sample = await page.evaluate([
    '(async()=>{',
    "const content=document.querySelector('.cm-content');",
    "const candidates=[];",
    "let scroller=null;",
    "for(let node=content;node;node=node.parentElement){",
    "const style=getComputedStyle(node);",
    "const entry={tag:node.tagName,className:node.className,overflowY:style.overflowY,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight};",
    "candidates.push(entry);",
    "if(!scroller&&node.scrollHeight>node.clientHeight+1&&(style.overflowY==='auto'||style.overflowY==='scroll'))scroller=node;",
    "}",
    "if(!scroller&&document.scrollingElement&&document.scrollingElement.scrollHeight>document.scrollingElement.clientHeight+1)scroller=document.scrollingElement;",
    "if(!scroller)return {error:'找不到真实滚动溢出容器',candidates};",
    'const started=performance.now();',
    'const times=[];',
    'return await new Promise((resolvePromise)=>{',
    'const tick=(now)=>{',
    'times.push(now);',
    'const elapsed=now-started;',
    'if(elapsed>=2000){',
    'const intervals=times.slice(1).map((value,index)=>value-times[index]);',
    'const sorted=intervals.slice().sort((a,b)=>a-b);',
    'const percentile=(ratio)=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*ratio))]:0;',
    'resolvePromise({durationMs:elapsed,frames:times.length,fps:times.length/(elapsed/1000),minFrameMs:sorted[0]||0,p95FrameMs:percentile(.95),scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight,candidates});',
    'return;',
    '}',
    'const maxScroll=Math.max(0,scroller.scrollHeight-scroller.clientHeight);',
    'scroller.scrollTop=maxScroll?((elapsed*0.35)%maxScroll):0;',
    'requestAnimationFrame(tick);',
    '};',
    'requestAnimationFrame(tick);',
    '});',
    '})()',
  ].join('\n'))
  if (sample?.error || !sample || sample.frames < 30) {
    throw new Error('编辑器 FPS 采样失败：' + JSON.stringify(sample))
  }
  await replaceEditor(page, baseline)
  await clickExact(page, '保存')
  await waitForText(page, '已保存')
  console.log('EDITOR_FPS_OK ' + JSON.stringify({ replaceMs, saveMs, ...sample }))
}

async function run() {
  rmSync(profile, { recursive: true, force: true })
  const projectPath = nativeDialogMode
    ? resolve(root, 'novelforge-desktop-e2e-project-' + process.pid)
    : resolve(tmpdir(), 'novelforge-desktop-e2e-project-' + process.pid)
  rmSync(projectPath, { recursive: true, force: true })
  if (nativeDialogMode) mkdirSync(projectPath, { recursive: true })
  if (coverMode) {
    mkdirSync(resolve(projectPath, 'attachments'), { recursive: true })
    copyFileSync(resolve(root, 'src-tauri/icons/icon.png'), resolve(projectPath, 'attachments/cover.png'))
  }
  const attachmentSource = resolve(tmpdir(), 'novelforge-e2e-attachment-' + process.pid + '.txt')
  rmSync(attachmentSource, { force: true })
  const providerServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ model: 'cdp-provider', choices: [{ message: { content: 'Provider 验收结果' } }] }))
  })
  await new Promise((resolvePromise) => providerServer.listen(0, '127.0.0.1', resolvePromise))
  const providerAddress = providerServer.address()
  if (!providerAddress || typeof providerAddress === 'string') throw new Error('无法启动本地 Provider 测试服务')
  const providerEndpoint = 'http://127.0.0.1:' + providerAddress.port + '/v1'
  let page
  let app
  let webdriver
  try {
    if (webdriverMode) {
      webdriver = await startWebDriver(true)
      page = new CdpPage(await waitForPage(webdriver.debuggerAddress), true)
    } else {
      app = spawn(executable, [], {
        env: {
          ...process.env,
          WEBVIEW2_USER_DATA_FOLDER: profile,
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port,
        },
        windowsHide: true,
        stdio: 'ignore',
      })
      page = new CdpPage(await waitForPage(), false)
    }
    await page.connect()
    if (!webdriverMode) await page.evaluate("window.confirm=()=>true; window.prompt=(_message, defaultValue)=>defaultValue || ''")
    const restartPage = async () => {
      page?.close()
      if (webdriver?.sessionId) {
        await requestJson('http://127.0.0.1:' + webdriverPort + '/session/' + webdriver.sessionId, { method: 'DELETE' }).catch(() => {})
        webdriver.sessionId = null
      }
      const oldDriver = webdriver?.driver
      const oldApp = app
      stopProcessTree(oldDriver)
      stopProcessTree(oldApp)
      await Promise.all([waitForProcessExit(oldDriver), waitForProcessExit(oldApp)])
      if (!webdriverMode) await waitForNoPage()
      await sleep(700)
      if (webdriverMode) {
        webdriver = await startWebDriver(false)
        page = new CdpPage(await waitForPage(webdriver.debuggerAddress), true)
      } else {
        const restartPort = port + 1
        app = spawn(executable, [], {
          env: {
            ...process.env,
            WEBVIEW2_USER_DATA_FOLDER: profile,
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + restartPort,
          },
          windowsHide: true,
          stdio: 'ignore',
        })
        page = new CdpPage(await waitForPage('127.0.0.1:' + restartPort), false)
      }
      await page.connect()
      if (!webdriverMode) await page.evaluate("window.confirm=()=>true; window.prompt=(_message, defaultValue)=>defaultValue || ''")
      return page
    }
    if (process.env.NOVELFORGE_E2E_VERBOSE === '1') {
      console.log('INITIAL_PAGE')
      console.log(await bodyText(page))
    }
    await clickText(page, '新建小说')
    await sleep(400)
    if (process.env.NOVELFORGE_E2E_VERBOSE === '1') {
      console.log('NEW_PROJECT_PAGE')
      console.log(await bodyText(page))
      console.log(await page.evaluate("Array.from(document.querySelectorAll('input,textarea')).map((item) => ({tag: item.tagName, type: item.getAttribute('type'), placeholder: item.getAttribute('placeholder'), aria: item.getAttribute('aria-label'), value: item.value}))"))
    }
    if (nativeDialogMode) await chooseNativeDialog(page, 'folder', '选择项目文件夹', projectPath)
    else await setField(page, '选择项目文件夹', projectPath)
    if (nativeDialogMode && process.env.NOVELFORGE_E2E_VERBOSE === '1') {
      console.log('NATIVE_PATH_INPUT', await page.evaluate("Array.from(document.querySelectorAll('input')).map((item) => ({placeholder: item.placeholder, value: item.value}))"))
    }
    await setField(page, '例如：雾港来信', 'CDP 桌面验收')
    await setField(page, '署名', '自动化测试')
    await setField(page, '现代 / 仙侠 / 科幻', '现代')
    await setField(page, '一句话记录这部作品想写什么。', '验证 release WebView2 交互。')
    await clickText(page, '创建并开始写作')
    await sleep(1200)
    if (process.env.NOVELFORGE_E2E_VERBOSE === '1') {
      console.log('WORKSPACE_PAGE')
      console.log(await bodyText(page))
    }
    if (process.env.NOVELFORGE_E2E_SNAPSHOT === '1') {
      console.log(await page.evaluate("Array.from(document.querySelectorAll('button')).map((item) => ({text: (item.textContent || '').trim(), title: item.getAttribute('title'), aria: item.getAttribute('aria-label')})).filter((item) => item.text || item.title || item.aria)"))
    }
    if (process.env.NOVELFORGE_E2E_SNAPSHOT === '1') return

    await replaceEditor(page, '# 第一章\n\n[[林月]] 来到雾港。\n\n**关键线索**\n\n- 第一项\n- 第二项')
    await sleep(400)
    const editorMenu = await (async () => {
      await rightClickSelector(page, '.cm-content')
      return assertCustomContextMenu(page, 'CodeMirror')
    })()
    if (!editorMenu.labels.some((label) => label.includes('格式')) || !editorMenu.labels.some((label) => label.includes('AI'))) {
      throw new Error('CodeMirror 右键菜单缺少格式或 AI 操作：' + JSON.stringify(editorMenu.labels))
    }
    const viewport = await page.evaluate('({width: window.innerWidth, height: window.innerHeight})')
    for (const point of [{ x: 2, y: 2 }, { x: viewport.width - 2, y: 2 }, { x: 2, y: viewport.height - 2 }, { x: viewport.width - 2, y: viewport.height - 2 }]) {
      await rightClickAt(page, point)
      await assertCustomContextMenu(page, '窗口角落')
    }
    console.log('CONTEXT_MENU_OK')
    await selectEditorAll(page)
    await pressControlKey(page, 'b', 'KeyB', 66)
    await waitForCondition(page, "document.querySelector('.cm-content')?.innerText.includes('**')", 'Ctrl+B 选区命令')
    await selectEditorAll(page)
    await pressControlKey(page, 'i', 'KeyI', 73)
    await waitForCondition(page, "document.querySelector('.cm-content')?.innerText.includes('*')", 'Ctrl+I 选区命令')
    await replaceEditor(page, '# 第一章\n\n[[林月]] 来到雾港。\n\n**关键线索**\n\n- 第一项\n- 第二项')
    await sleep(250)
    await clickExact(page, '保存')
    await waitForText(page, '已保存')
    await clickExact(page, '预览')
    await sleep(250)
    await waitForText(page, '关键线索')
    await clickExact(page, '分栏')
    await sleep(250)
    await clickExact(page, '编辑')
    await waitForCondition(page, "document.querySelector('.cm-content') !== null", '编辑器重新出现')
    await clickExact(page, '关闭')
    await waitForText(page, '新建小说')
    await clickText(page, 'CDP 桌面验收')
    await waitForText(page, 'MANUSCRIPT / CHAPTER')
    await waitForCondition(page, "document.querySelector('.cm-content')?.innerText.includes('关键线索')", '最近项目重开正文')
    await clickTitle(page, '项目设置')
    await waitForText(page, '项目设置')
    await clickExact(page, '正文')
    await waitForText(page, 'MANUSCRIPT / CHAPTER')
    await clickExact(page, '写作规划')
    await waitForText(page, '写作规划')
    await clickExact(page, '正文')
    await waitForText(page, 'MANUSCRIPT / CHAPTER')

    await clickExact(page, '版本历史')
    await waitForText(page, 'Diff')
    await clickExact(page, 'Diff')
    await waitForCondition(page, "document.querySelector('.history-diff') !== null", '历史 Diff')
    await clickExact(page, '恢复')
    await sleep(500)
    await waitForCondition(page, "document.querySelector('.cm-content') !== null", '历史版本恢复后的编辑器')
    await replaceEditor(page, '# 第一章\n\n[[林月]] 来到雾港。\n\n**关键线索**\n\n- 第一项\n- 第二项')
    await clickExact(page, '保存')
    await waitForText(page, '已保存')

    await clickTitle(page, '新建卷')
    await waitForText(page, '新建卷')
    await setField(page, '第二卷', '第二卷')
    await clickModalButton(page, '创建')
    await waitForText(page, '第二卷')
    await clickRowAction(page, '第二卷', '在此新建章')
    await waitForText(page, '新建章')
    await setField(page, '第二章', '第二章')
    await clickModalButton(page, '创建')
    await clickRowAction(page, '第二卷', '展开')
    await waitForText(page, '第二章')
    await rightClickSelector(page, '.tree-row', '第二章')
    const chapterMenu = await assertCustomContextMenu(page, '章节树')
    if (!chapterMenu.labels.some((label) => label.includes('复制章节')) || !chapterMenu.labels.some((label) => label.includes('写作状态'))) {
      throw new Error('章节树右键菜单内容不完整：' + JSON.stringify(chapterMenu.labels))
    }
    console.log('CORE_EDITOR_TREE_OK')

    await clickRowAction(page, '第二章', '在此新建节')
    await waitForText(page, '新建节')
    await setField(page, '开场', '开场')
    await clickModalButton(page, '创建')
    await clickRowAction(page, '第二章', '展开')
    await waitForText(page, '开场')
    if (!webdriverMode) await page.evaluate("window.prompt=()=> '序章'")
    await clickRowAction(page, '开场', '更多操作')
    await waitForText(page, '序章')
    if (!webdriverMode) await page.evaluate("window.prompt=(_message, defaultValue)=>defaultValue || ''")

    await dragRow(page, '第二章', '第一卷')
    await ensureTreeRow(page, '第一卷', '第二章')
    if (!(await treeRowUnderParent(page, '第二章', '第一卷'))) throw new Error('拖拽后章节未进入第一卷')
    console.log('DRAG_DROP_OK')

    await clickRowAction(page, '第二章', '复制节点')
    await waitForText(page, '复制正文节点')
    await setCurrentValue(page, '副本', '第二章 副本')
    await clickModalButton(page, '复制')
    await ensureTreeRow(page, '第二卷', '第二章 副本')
    await clickRowAction(page, '第二章', '复制节点')
    await waitForText(page, '复制正文节点')
    await setCurrentValue(page, '副本', '第二章 副本二')
    await clickModalButton(page, '复制')
    await ensureTreeRow(page, '第二卷', '第二章 副本二')
    await toggleRowSelection(page, '第二章 副本')
    await toggleRowSelection(page, '第二章 副本二')
    await waitForText(page, '已选 2 项')
    await clickExact(page, '批量移入回收站')
    await sleep(500)
    await clickExact(page, '回收站')
    await waitForText(page, '回收站')
    await clickSelector(page, '.trash-actions button', '恢复')
    await sleep(500)
    await clickSelector(page, '.trash-actions button', '恢复')
    await sleep(500)
    await waitForText(page, '回收站是空的')
    await clickExact(page, '正文')
    await waitForText(page, 'MANUSCRIPT / CHAPTER')
    console.log('HISTORY_AND_TREE_ACTIONS_OK')

    await clickText(page, '人物')
    await waitForCondition(page, "document.querySelector('.entity-list-head h2')?.textContent?.trim() === '人物'", '人物资料视图')
    await clickSelector(page, '.entity-list-head button', '新建')
    await setField(page, '输入人物名称', '林月')
    await setField(page, '添加标签', '主角')
    await clickSelector(page, '.custom-fields-panel .panel-title button', '添加字段')
    await setField(page, '字段名', '身份')
    await setField(page, '字段值', '守夜人')
    await clickSelector(page, '.entity-actions button', '保存资料')
    await waitForText(page, '林月')
    await sleep(500)

    await clickExact(page, '地点')
    await sleep(350)
    if (!(await page.evaluate("document.querySelector('.entity-list-head h2')?.textContent?.trim() === '地点'"))) {
      await clickExact(page, '地点')
      await sleep(350)
    }
    await waitForCondition(page, "document.querySelector('.entity-list-head h2')?.textContent?.trim() === '地点'", '地点资料视图')
    await clickSelector(page, '.entity-list-head button', '新建')
    await setField(page, '输入地点名称', '雾港')
    await setField(page, '添加标签', '北境')
    await clickSelector(page, '.entity-actions button', '保存资料')
    await waitForText(page, '雾港')
    await sleep(500)

    await clickExact(page, '世界观 Wiki')
    await sleep(350)
    if (!(await page.evaluate("document.querySelector('.entity-list-head h2')?.textContent?.trim() === '世界观'"))) {
      await clickExact(page, '世界观 Wiki')
      await sleep(350)
    }
    await waitForCondition(page, "document.querySelector('.entity-list-head h2')?.textContent?.trim() === '世界观'", '世界观资料视图')
    await clickSelector(page, '.entity-list-head button', '新建')
    await setField(page, '输入世界观名称', '潮汐历法')
    await clickSelector(page, '.entity-actions button', '保存资料')
    await waitForText(page, '潮汐历法')
    console.log('ENTITY_CRUD_OK')

    await clickExact(page, '正文')
    await ensureEditor(page, 'Wiki 返回')
    await clickExact(page, '预览')
    await waitForSelector(page, 'a.wiki-link', 'Wiki 预览链接')
    await clickSelector(page, 'a.wiki-link', '林月')
    await waitForCondition(page, "document.querySelector('.entity-list-head h2')?.textContent?.trim() === '人物'", 'Wiki 跳转人物')
    await clickExact(page, '正文')
    await ensureEditor(page, 'Wiki 返回正文')
    console.log('WIKI_NAVIGATION_OK')

    await clickTitle(page, '项目设置')
    await waitForText(page, '项目设置')
    await clickExact(page, '深色')
    await waitForCondition(page, "document.documentElement.dataset.theme === 'dark'", '深色主题')
    await clickTitle(page, '收起左栏')
    await waitForCondition(page, "document.querySelector('.main-layout')?.classList.contains('sidebar-closed')", '收起左栏')
    await clickTitle(page, '展开左栏')
    await clickTitle(page, '收起辅助栏')
    await waitForCondition(page, "document.querySelector('.main-layout')?.classList.contains('inspector-closed')", '收起辅助栏')
    await clickTitle(page, '展开辅助栏')
    await clickExact(page, '正文')
    await waitForCondition(page, "document.querySelector('.cm-content') !== null", '设置返回正文')
    await clickTitle(page, '专注模式（F11）')
    await waitForCondition(page, "document.querySelector('.app-shell')?.classList.contains('focus-mode')", 'F11 专注模式')
    await clickTitle(page, '专注模式（F11）')
    await waitForCondition(page, "document.querySelector('.app-shell')?.classList.contains('focus-mode') === false", '退出专注模式')

    await pressControlKey(page, 'k', 'KeyK', 75)
    await waitForSelector(page, '.command-palette', '命令面板')
    await setField(page, '搜索命令', '全项目搜索')
    await clickSelectorContains(page, '.command-main', '全项目搜索')
    await waitForText(page, '全文搜索')
    await clickExact(page, '正文')
    await waitForCondition(page, "document.querySelector('.cm-content') !== null", '命令面板返回正文')
    await pressControlKey(page, 'k', 'KeyK', 75)
    await waitForSelector(page, '.command-palette', '快捷键命令面板')
    await setField(page, '搜索命令', '全项目搜索')
    await clickTitle(page, '点击设置快捷键')
    await pressControlKey(page, 'f', 'KeyF', 70)
    await waitForText(page, '已被')
    await clickExact(page, '恢复默认')
    await pressEscape(page)
    await pressEscape(page)
    await waitForCondition(page, "document.querySelector('.command-palette') === null", '关闭命令面板')
    console.log('SETTINGS_COMMANDS_OK')

    await runRecoveryFlow(page, projectPath, 'CDP 桌面验收', restartPage)
    if (process.env.NOVELFORGE_E2E_FPS === '1') await runEditorPerformanceFlow(page)

    if (nativeDialogMode) {
      writeFileSync(attachmentSource, 'NovelForge 原生文件选择器验收附件。\n', 'utf8')
      await clickExact(page, '资料附件')
      await waitForText(page, '资料附件')
      await chooseNativeDialog(page, 'file', '选择要导入的附件', attachmentSource, '导入附件')
      await waitForText(page, 'novelforge-e2e-attachment-' + process.pid + '.txt')
      await setField(page, '记录这份素材和小说的关系…', '原生 UI Automation 导入')
      await clickExact(page, '保存说明')
      const importedFile = readdirSync(resolve(projectPath, 'attachments')).find((name) => name.endsWith('.txt'))
      if (!importedFile) throw new Error('附件目录未生成导入文件')
      const importedContent = readFileSync(resolve(projectPath, 'attachments', importedFile), 'utf8')
      if (!importedContent.includes('原生文件选择器验收附件')) throw new Error('导入附件内容不完整')
      console.log('NATIVE_DIALOGS_OK')
    }

    for (const view of ['时间线', '伏笔', '人物关系图', '一致性检查', '详细统计']) {
      await clickExact(page, view)
      await waitForText(page, view)
    }
    console.log('PLANNING_AND_CHECKS_OK')

    await clickText(page, '全文搜索')
    await waitForText(page, '全文搜索')
    await setField(page, '输入关键词，例如：雾港、林月、失踪…', '雾港')
    await waitForText(page, '第一章')
    console.log('SEARCH_OK')

    await clickExact(page, '正文')
    await waitForCondition(page, "document.querySelector('.cm-content') !== null", '编辑器返回')
    await selectEditorAll(page)
    await clickText(page, 'AI 辅助')
    await waitForText(page, 'AI 辅助')
    await waitForText(page, '已捕获当前选区')
    await selectValue(page, '.ai-action-card select', 'polish')
    await clickExact(page, '选中最近 3 章')
    await clickExact(page, '运行辅助')
    await waitForCondition(page, "document.querySelector('.ai-result-text')?.value.includes('本地润色草稿')", '本地 AI 结果')
    await pressEscape(page)
    await waitForText(page, '等待一次辅助任务')
    console.log('AI_SELECTION_AND_CANCEL_OK')
    await setField(page, '留空使用本地离线模式', providerEndpoint)
    await setField(page, 'local-writer', 'cdp-model')
    await clickExact(page, '运行辅助')
    await waitForCondition(page, "document.querySelector('.ai-result-text')?.value.includes('Provider 验收结果')", '本地 Provider AI 结果')
    await pressEscape(page)
    await waitForText(page, '等待一次辅助任务')
    console.log('AI_PROVIDER_OK')

    await clickText(page, '人物')
    await waitForCondition(page, "document.querySelector('.entity-list-head h2')?.textContent?.trim() === '人物'", '返回人物资料')
    await clickSelectorContains(page, '.entity-list-item', '林月')
    await waitForSelector(page, '.entity-actions', '人物编辑操作')
    await clickSelector(page, '.entity-actions button', '移入回收站')
    await sleep(500)
    await clickExact(page, '回收站')
    await waitForSelector(page, '.trash-view', '回收站视图')
    await waitForCondition(page, "document.querySelectorAll('.trash-actions button').length > 0", '回收站删除条目加载')
    await clickSelector(page, '.trash-actions button', '恢复')
    await waitForSelector(page, '.trash-view .empty-state', '回收站恢复后为空')
    console.log('TRASH_RESTORE_OK')

    const exports = [
      ['Markdown', 'markdown'],
      ['纯文本 TXT', 'txt'],
      ['网页 HTML', 'html'],
      ['Word DOCX', 'docx'],
      ['电子书 EPUB', 'epub'],
      ['PDF', 'pdf'],
    ]
    for (let index = 0; index < exports.length; index += 1) {
      const format = exports[index]
      await clickExact(page, '导出')
      await waitForText(page, '导出项目')
      if (coverMode) await setField(page, 'attachments/cover.jpg', 'attachments/cover.png')
      await clickText(page, format[0])
      await waitForExport(projectPath, format[1])
    }
    const exportFiles = readdirSync(resolve(projectPath, '.novelforge', 'exports'))
    if (!exports.every(([, extension]) => exportFiles.some((name) => name.endsWith('.' + extension)))) {
      throw new Error('六种导出文件未全部生成：' + exportFiles.join(', '))
    }
    const fileFor = (extension) => {
      const name = exportFiles.find((item) => item.endsWith('.' + extension))
      if (!name) throw new Error('找不到导出文件：' + extension)
      return resolve(projectPath, '.novelforge', 'exports', name)
    }
    const markdown = readFileSync(fileFor('markdown'), 'utf8')
    const plainText = readFileSync(fileFor('txt'), 'utf8')
    const html = readFileSync(fileFor('html'), 'utf8')
    if (!markdown.includes('雾港') || !markdown.includes('**关键线索**')) throw new Error('Markdown 导出缺少中文或粗体结构')
    if (plainText.includes('**') || plainText.includes('[[') || !plainText.includes('关键线索')) throw new Error('TXT 导出未清理 Markdown/Wiki 标记')
    if (!html.includes('<strong>') || !html.includes('雾港')) throw new Error('HTML 导出缺少语义结构')
    if (readFileSync(fileFor('pdf')).subarray(0, 5).toString() !== '%PDF-' ) throw new Error('PDF 导出头不正确')
    for (const extension of ['docx', 'epub']) {
      if (readFileSync(fileFor(extension)).length < 200) throw new Error(extension + ' 导出文件为空')
    }
    console.log('EXPORTS_OK')
    if (keepProject) console.log('E2E_PROJECT_PATH ' + projectPath)
  } finally {
    page?.close()
    if (webdriver?.sessionId) {
      await requestJson('http://127.0.0.1:' + webdriverPort + '/session/' + webdriver.sessionId, { method: 'DELETE' }).catch(() => {})
    }
    stopProcessTree(webdriver?.driver)
    stopProcessTree(app)
    await sleep(500)
    rmSync(profile, { recursive: true, force: true })
    if (!keepProject) rmSync(projectPath, { recursive: true, force: true })
    rmSync(attachmentSource, { force: true })
    await new Promise((resolvePromise) => providerServer.close(resolvePromise))
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})

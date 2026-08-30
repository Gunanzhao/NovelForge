import { spawn } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'src-tauri/target/release/novelforge.exe')
const port = Number(process.env.NOVELFORGE_E2E_PORT ?? 9223)
const profile = resolve(tmpdir(), 'novelforge-e2e-' + process.pid)
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

if (!existsSync(executable)) throw new Error('release EXE 不存在：' + executable)

async function waitForPage() {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then((response) => response.json())
      const page = pages.find((item) => item.type === 'page' && item.url.startsWith('http://tauri.localhost'))
      if (page) return page
    } catch {
      // WebView2 调试端口尚未就绪。
    }
    await sleep(250)
  }
  throw new Error('等待 WebView2 CDP 页面超时，端口：' + port)
}

class CdpPage {
  constructor(page) {
    this.socket = new WebSocket(page.webSocketDebuggerUrl)
    this.nextId = 1
    this.pending = new Map()
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
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

function jsString(value) {
  return JSON.stringify(value)
}

async function bodyText(page) {
  return page.evaluate('document.body.innerText')
}

async function clickText(page, text) {
  const expression = "Array.from(document.querySelectorAll('button')).find((button) => (button.textContent || '').includes(" + jsString(text) + "))?.click(); true"
  const clicked = await page.evaluate(expression)
  if (!clicked) throw new Error('找不到按钮：' + text)
}

async function clickExact(page, text) {
  const expression = "Array.from(document.querySelectorAll('button')).find((button) => (button.textContent || '').trim() === " + jsString(text) + ")?.click(); true"
  const clicked = await page.evaluate(expression)
  if (!clicked) throw new Error('找不到精确按钮：' + text)
}

async function clickTitle(page, title) {
  const expression = "Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('title') === " + jsString(title) + ")?.click(); true"
  const clicked = await page.evaluate(expression)
  if (!clicked) throw new Error('找不到标题按钮：' + title)
}

async function clickSelector(page, selector, text) {
  const expression = "(function(){const item=Array.from(document.querySelectorAll(" + jsString(selector) + ")).find((node)=>(node.textContent||'').trim()===" + jsString(text) + ");item?.click();return Boolean(item)})()"
  if (!await page.evaluate(expression)) throw new Error('找不到指定控件：' + selector + ' / ' + text)
}

async function clickRowAction(page, rowText, title) {
  const expression = "(function(){const row=Array.from(document.querySelectorAll('.tree-row')).find((item)=>(item.textContent||'').includes(" + jsString(rowText) + "));const action=Array.from(row?.querySelectorAll('button')||[]).find((button)=>button.getAttribute('title')===" + jsString(title) + ");action?.click();return Boolean(action)})()"
  if (!await page.evaluate(expression)) throw new Error('找不到正文树操作：' + rowText + ' / ' + title)
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

async function pressEscape(page) {
  await page.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
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

async function setField(page, labelOrPlaceholder, value) {
  const key = jsString(labelOrPlaceholder)
  const nextValue = jsString(value)
  const expression = "(function(){const target=Array.from(document.querySelectorAll('input,textarea')).find((item)=>(item.getAttribute('aria-label')||item.getAttribute('placeholder')||'').includes(" + key + "));if(!target)return false;const prototype=target instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;if(!setter)return false;setter.call(target," + nextValue + ");target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));return true})()"
  if (!await page.evaluate(expression)) throw new Error('找不到输入框：' + labelOrPlaceholder)
}

async function waitForText(page, text) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if ((await bodyText(page)).includes(text)) return
    await sleep(200)
  }
  throw new Error('页面未出现文本：' + text + '\n当前页面：\n' + await bodyText(page))
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

async function run() {
  rmSync(profile, { recursive: true, force: true })
  const projectPath = resolve(tmpdir(), 'novelforge-desktop-e2e-project-' + process.pid)
  rmSync(projectPath, { recursive: true, force: true })
  const app = spawn(executable, [], {
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port,
    },
    windowsHide: true,
    stdio: 'ignore',
  })
  let page
  try {
    page = new CdpPage(await waitForPage())
    await page.connect()
    await page.evaluate("window.confirm=()=>true; window.prompt=(_message, defaultValue)=>defaultValue || ''")
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
    await setField(page, '选择项目文件夹', projectPath)
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
    await clickExact(page, '保存')
    await waitForText(page, '已保存')
    await clickExact(page, '预览')
    await sleep(250)
    await waitForText(page, '关键线索')
    await clickExact(page, '分栏')
    await sleep(250)
    await clickExact(page, '编辑')
    await waitForCondition(page, "document.querySelector('.cm-content') !== null", '编辑器重新出现')
    await clickExact(page, '写作规划')
    await waitForText(page, '写作规划')
    await clickExact(page, '正文')
    await waitForText(page, 'MANUSCRIPT / CHAPTER')

    await clickTitle(page, '新建卷')
    await waitForText(page, '新建卷')
    await setField(page, '第二卷', '第二卷')
    await clickExact(page, '创建')
    await waitForText(page, '第二卷')
    await clickRowAction(page, '第二卷', '在此新建章')
    await waitForText(page, '新建章')
    await setField(page, '第二章', '第二章')
    await clickExact(page, '创建')
    await clickRowAction(page, '第二卷', '展开')
    await waitForText(page, '第二章')
    console.log('CORE_EDITOR_TREE_OK')

    await clickExact(page, '人物0')
    await waitForText(page, '人物 ARCHIVE')
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
    if (!(await bodyText(page)).includes('地点 ARCHIVE')) {
      await clickExact(page, '地点')
      await sleep(350)
    }
    await waitForText(page, '地点 ARCHIVE')
    await clickSelector(page, '.entity-list-head button', '新建')
    await setField(page, '输入地点名称', '雾港')
    await setField(page, '添加标签', '北境')
    await clickSelector(page, '.entity-actions button', '保存资料')
    await waitForText(page, '雾港')
    await sleep(500)

    await clickExact(page, '世界观 Wiki')
    await sleep(350)
    if (!(await bodyText(page)).includes('世界观 ARCHIVE')) {
      await clickExact(page, '世界观 Wiki')
      await sleep(350)
    }
    await waitForText(page, '世界观 ARCHIVE')
    await clickSelector(page, '.entity-list-head button', '新建')
    await setField(page, '输入世界观名称', '潮汐历法')
    await clickSelector(page, '.entity-actions button', '保存资料')
    await waitForText(page, '潮汐历法')
    console.log('ENTITY_CRUD_OK')

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

    await clickExact(page, '人物0')
    await waitForText(page, '林月')
    await clickText(page, '林月')
    await waitForText(page, '移入回收站')
    await clickExact(page, '移入回收站')
    await sleep(500)
    await clickExact(page, '回收站')
    await waitForText(page, '回收站')
    await clickExact(page, '恢复')
    await waitForText(page, '回收站是空的')
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
      await clickText(page, format[0])
      await waitForExport(projectPath, format[1])
    }
    const exportFiles = readdirSync(resolve(projectPath, '.novelforge', 'exports'))
    if (!exports.every(([, extension]) => exportFiles.some((name) => name.endsWith('.' + extension)))) {
      throw new Error('六种导出文件未全部生成：' + exportFiles.join(', '))
    }
    console.log('EXPORTS_OK')
  } finally {
    page?.close()
    app.kill()
    await sleep(500)
    rmSync(profile, { recursive: true, force: true })
    rmSync(projectPath, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})

/* global console, process, fetch, URL, crypto, WebSocket, setTimeout, clearTimeout */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Uses the actual production EXE, WebView2, serde and registered Tauri dispatcher.
// No native file dialogs or real AI accounts. All data are synthetic and retained
// on failure for diagnosis; runner temp handles eventual cleanup.
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/reliability-contract.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
const temporary = mkdtempSync(join(tmpdir(), 'novelforge-可靠性-'))
const projectPath = join(temporary, '中文小说')
const backups = join(temporary, '备份')
mkdirSync(projectPath); mkdirSync(backups)
const port = Number(process.env.NOVELFORGE_SMOKE_PORT ?? 9337)
const executable = resolve(process.argv[2] ?? 'src-tauri/target/release/novelforge.exe')
const launch = () => spawn(executable, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, APPDATA: join(temporary, 'appdata'), LOCALAPPDATA: join(temporary, 'localappdata'), WEBVIEW2_USER_DATA_FOLDER: join(temporary, 'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } })
let child = launch()
let socket
let started = false
try {
  let target
  let launchError
  child.on('error', error => { launchError = error })
  for (let attempt = 0; attempt < 160; attempt++) {
    if (launchError) throw launchError
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page' && page.url.startsWith('http://tauri.localhost')) } catch { /* startup */ }
    if (target) break
    await delay(250)
  }
  if (!target) throw new Error('ENVIRONMENT: WebView2 unavailable; runner needs a Windows desktop session and WebView2 runtime')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((yes, no) => { socket.addEventListener('open', yes, { once: true }); socket.addEventListener('error', no, { once: true }) })
  let next = 0
  const pending = new Map()
  const route = event => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id); clearTimeout(waiter.timer)
    if (message.error) waiter.no(new Error(JSON.stringify(message.error)))
    else waiter.yes(message.result)
  }
  socket.addEventListener('message', route)
  const evaluate = expression => new Promise((yes, no) => {
    const id = ++next
    pending.set(id, { yes, no, timer: setTimeout(() => { pending.delete(id); no(new Error('IPC timeout')) }, 30000) })
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  }).then(result => { assert.equal(result.exceptionDetails, undefined); return result.result.value })
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate("Boolean(window.__TAURI_INTERNALS__?.invoke)")) { started = true; break }
    await delay(250)
  }
  assert.ok(started, 'production Tauri bridge must initialize')
  const invoke = async (command, args) => {
    const envelope = await evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)}).then(value=>({ok:true,value}),error=>({ok:false,error}))`)
    if (!envelope.ok) throw envelope.error
    return envelope.value
  }
  const expectError = async (command, args, prefix) => {
    let caught
    try { await invoke(command, args) } catch (error) { caught = error }
    assert.equal(typeof caught, 'string', 'error envelope drift: expected string rejection')
    if (prefix) assert.ok(caught.startsWith(prefix), 'stable error prefix drift')
  }
  const created = await invoke('create_project', { input: { ...fixture.project, path: projectPath } })
  assert.equal(created.project.title, fixture.project.title)
  for (const input of [null, {}, { ...fixture.node, projectPath: null }]) await expectError('create_node', { input })
  let data = await invoke('create_node', { input: { ...fixture.node, projectPath, parentId: created.nodes.find(node => node.kind === 'volume').id } })
  const node = data.nodes.find(item => item.title === fixture.node.title)
  assert.ok(node)
  const original = await invoke('get_document', { input: { projectPath, nodeId: node.id } })
  const input = { projectPath, nodeId: node.id, content: fixture.body, reason: '手动保存' }
  const saved = await invoke('save_document_annotated', { input, expectedContent: original.content, annotationAnchors: null })
  assert.equal(saved.content, fixture.body)
  assert.equal(typeof saved.historyCreated, 'boolean')
  // Controlled request drift: renamed or missing required fields must reject.
  const { content, ...withoutContent } = input
  await expectError('save_document_annotated', { input: { ...withoutContent, body: content }, expectedContent: content })
  await expectError('save_document_annotated', { input, expectedContent: null })
  await expectError('save_document_annotated', { input })
  await invoke('save_document_annotated', { input, expectedContent: content }) // optional omitted
  let opened = await invoke('prepare_open_project', { path: projectPath })
  assert.match(opened.leaseToken, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  await expectError('release_project_lease', { path: projectPath, token: null })
  await expectError('release_project_lease', { path: projectPath })
  await invoke('release_project_lease', { path: projectPath, token: opened.leaseToken })
  opened = await invoke('prepare_open_project', { path: projectPath })
  assert.equal((await invoke('get_document', { input: { projectPath, nodeId: node.id } })).content, content)
  const diskPath = join(projectPath, node.filePath)
  const before = readFileSync(diskPath, 'utf8')
  const external = before.replace(content, '外部新正文\n')
  assert.notEqual(before, external)
  writeFileSync(diskPath, external)
  await expectError('save_document_annotated', { input, expectedContent: content }, fixture.conflictCode)
  assert.equal(readFileSync(diskPath, 'utf8'), external)
  const recovery = await invoke('list_recovery', { path: projectPath })
  assert.ok(recovery.length)
  assert.equal(await invoke('read_recovery', { input: { projectPath, recoveryId: recovery[0].id } }), content)
  await invoke('save_document_annotated', { input, expectedContent: '外部新正文\n' })
  const backup = await invoke('backup_project', { path: projectPath, directory: backups })
  assert.ok(backup.fileCount > 0)
  const restored = await invoke('restore_backup', { path: backup.path, directory: temporary })
  const restoredProject = await invoke('prepare_open_project', { path: restored.path })
  assert.equal((await invoke('get_document', { input: { projectPath: restored.path, nodeId: node.id } })).content, content)
  const exported = await invoke('export_project', { input: { projectPath: restored.path, format: 'markdown' } })
  assert.ok(readFileSync(exported, 'utf8').includes(content), 'export must include actual complete body')
  await invoke('release_project_lease', { path: restored.path, token: restoredProject.leaseToken })
  await invoke('release_project_lease', { path: projectPath, token: opened.leaseToken })
  const metadataPath = join(projectPath, 'project.json')
  const metadataBytes = readFileSync(metadataPath)
  const future = { ...JSON.parse(metadataBytes.toString()), formatVersion: 999 }
  writeFileSync(metadataPath, JSON.stringify(future))
  const futureBytes = readFileSync(metadataPath)
  const databaseBytes = readFileSync(join(projectPath, '.novelforge/database.sqlite'))
  await expectError('prepare_open_project', { path: projectPath }, 'PROJECT_FORMAT:')
  assert.deepEqual(readFileSync(metadataPath), futureBytes)
  assert.deepEqual(readFileSync(join(projectPath, '.novelforge/database.sqlite')), databaseBytes)
  writeFileSync(metadataPath, metadataBytes) // restore only this synthetic fixture
  const journals = join(restored.path, '.novelforge/batch-journal')
  mkdirSync(journals, { recursive: true })
  const badJournal = join(journals, crypto.randomUUID() + '.json')
  writeFileSync(badJournal, '{truncated')
  await expectError('prepare_open_project', { path: restored.path }, 'BATCH_RECOVERY:')
  const rescue = await invoke('inspect_project_rescue', { path: restored.path })
  assert.equal(rescue.unresolved, true)
  assert.ok(rescue.files.some(file => file.content.includes(content)))
  assert.equal(readFileSync(badJournal, 'utf8'), '{truncated')
  const draft = { id: crypto.randomUUID(), projectId: created.project.id, projectPath, targetId: 'document:' + node.id, label: '强制退出验收', version: Date.now() * 1000, capturedAt: new Date().toISOString(), payload: { content: '仅独立快照保存的正文😀' } }
  await invoke('put_draft_snapshot', { input: draft })
  const newer = { ...draft, id: crypto.randomUUID(), version: draft.version + 1, payload: { content: '强制退出前的新版本😀' } }
  await invoke('put_draft_snapshot', { input: newer })
  await invoke('acknowledge_draft_snapshot', { id: draft.id })
  socket.close()
  execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  await delay(500)
  child = launch()
  let restarted
  for (let attempt = 0; attempt < 160; attempt++) {
    try { restarted = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page => page.type === 'page' && page.url.startsWith('http://tauri.localhost')) } catch { /* starting */ }
    if (restarted) break
    await delay(250)
  }
  assert.ok(restarted, 'restart must expose WebView2')
  socket = new WebSocket(restarted.webSocketDebuggerUrl)
  await new Promise((yes, no) => { socket.addEventListener('open', yes, { once: true }); socket.addEventListener('error', no, { once: true }) })
  socket.addEventListener('message', route)
  for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate('Boolean(window.__TAURI_INTERNALS__?.invoke)')) break; await delay(250) }
  await expectError('prepare_open_project', { path: restored.path }, 'BATCH_RECOVERY:')
  const surviving = await invoke('list_draft_snapshots', {})
  assert.equal(surviving.find(item => item.id === newer.id)?.payload.content, newer.payload.content)
  await invoke('acknowledge_draft_snapshot', { id: newer.id })
  console.log('PASS: independent draft survives forced EXE termination, restart and old-version acknowledgement')
  // Response drift negative controls: field rename/error envelope changes fail validators.
  assert.throws(() => assert.equal({ body: saved.content }.content, content))
  assert.throws(() => assert.equal(typeof { code: fixture.conflictCode }, 'string'))
  console.log('PASS: production Windows IPC/serde, Unicode, null/missing/optional, drift controls, leases, reopen, conflict rescue, backup restore and exported body')
} catch (error) {
  console.error(started ? 'PRODUCT_OR_TEST_FAILURE' : 'STARTUP_OR_ENVIRONMENT_FAILURE', error)
  process.exitCode = 1
} finally {
  socket?.close()
  if (child.pid) { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) } catch { /* already exited */ } }
}

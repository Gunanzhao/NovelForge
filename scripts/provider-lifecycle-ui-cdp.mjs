/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/provider-lifecycle-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve('src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9471' } })
let socket, seq = 0
const pending = new Map()
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async expression => { const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
const call = (name, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
const click = text => ev(`(()=>{const scope=[...document.querySelectorAll('[role="dialog"]')].filter(e=>e.getClientRects().length).at(-1)??document;const e=[...scope.querySelectorAll('button')].find(e=>e.getClientRects().length&&(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(text)});if(!e)throw Error('missing '+${JSON.stringify(text)});e.click()})()`)
const waitFor = async (expression, count = 100) => { for (let i=0;i<count;i++) { if (await ev(expression)) return; await sleep(250) } throw Error('Timed out: '+expression) }
const capture = async name => { const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,name+'.png'),Buffer.from(shot.data,'base64')) }

const requests=[]
let active=0, maximumActive=0, cancelled=false
const server=createServer((request,response)=>{
  let body=''
  request.on('data',chunk=>{body+=chunk})
  request.on('end',()=>{
    requests.push(JSON.parse(body));const index=requests.length
    active++;maximumActive=Math.max(maximumActive,active)
    response.on('close',()=>{active--;if(index===2&&!response.writableEnded)cancelled=true})
    if(index===2)return
    response.writeHead(200,{'Content-Type':'application/json'})
    response.end(JSON.stringify({choices:[{message:{content:index===1?'风很暖。':'风很暖。灯很亮。'},finish_reason:index===1?'length':'stop'}],model:'synthetic-writer'}))
  })
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
try {
  let target
  for(let i=0;i<100;i++){try{target=(await(await fetch('http://127.0.0.1:9471/json/list')).json()).find(item=>item.type==='page');if(target)break}catch{/* startup */}await sleep(200)}
  assert.ok(target);socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data),task=pending.get(message.id);if(task){pending.delete(message.id);if(message.error)task.reject(Error(message.error.message));else task.resolve(message.result)}})
  await cmd('Runtime.enable');await waitFor('!!window.__TAURI_INTERNALS__?.invoke')
  await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
  const projectPath=resolve(run,'project')
  const data=await call('create_project',{input:{path:projectPath,title:'正文 AI 验收',author:'',genre:'',description:'',targetWords:1000}})
  const chapter=data.nodes.find(node=>node.kind==='chapter')
  const original='# 雨夜\n\n前文。风很冷。灯很暗。后文。\n\n远处的钟声响了，街灯下的影子慢慢走过。'.replaceAll('\\n','\n')
  await call('save_document',{input:{projectPath,nodeId:chapter.id,content:original,reason:'合成测试'}})
  const preferences={mode:'provider',endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'synthetic-writer'}
  await ev(`localStorage.setItem('novelforge:ai-preferences:v1',${JSON.stringify(JSON.stringify(preferences))});localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{path:projectPath,title:'正文 AI 验收',updatedAt:''}]))});location.reload()`)
  await sleep(800);await waitFor(`!!document.querySelector('.recent-project')`);await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.cm-content')?.cmTile?.root?.view`)
  await ev(`window.editor=()=>document.querySelector('.cm-content').cmTile.root.view`)
  const start=original.indexOf('风很冷')
  await ev(`editor().focus();editor().dispatch({selection:{anchor:${start},head:${start+8}}})`)
  await waitFor(`!!document.querySelector('.editor-ai-floating')`)
  await capture('selection-toolbar')
  await ev(`document.querySelector('.editor-ai-floating button').click()`)
  await waitFor(`!document.querySelector('.ai-host').hidden`)
  assert.equal(requests.length,0)
  assert.equal(await ev(`document.querySelector('.workspace').hidden`),false)
  await click('预览上下文');await waitFor(`!!document.querySelector('.ai-request-dialog [role="dialog"]')`)
  assert.ok(await ev(`document.querySelector('.ai-preview-panel').textContent.includes('风很冷。灯很暗。')`))
  assert.equal(await ev(`document.querySelector('.ai-preview-panel').textContent.includes('后文。')`),false)
  await capture('inline-preview');await click('返回编辑')
  await click('运行辅助')
  await waitFor(`document.querySelector('.ai-output-heading').textContent.includes('结果不完整')`)
  assert.equal(await ev(`document.querySelector('.ai-result-text').readOnly`),true)
  assert.equal(await ev(`!![...document.querySelectorAll('.ai-result-actions button')].find(e=>/替换|插入|追加/.test(e.textContent))`),false)
  assert.equal(await ev('editor().state.doc.toString()'),original)
  await capture('incomplete-protected')
  await click('运行辅助')
  for(let i=0;i<100&&requests.length<2;i++)await sleep(20)
  assert.equal(requests.length,2)
  const started=Date.now()
  await Promise.race([call('get_document',{input:{projectPath,nodeId:chapter.id}}),sleep(1500).then(()=>{throw Error('Native IPC blocked during generation')})])
  const responsiveMs=Date.now()-started
  await click('停止接收')
  for(let i=0;i<100&&!cancelled;i++)await sleep(20)
  assert.equal(cancelled,true,'stop must close the pending HTTP response')
  await click('运行辅助')
  await waitFor(`document.querySelector('.ai-output-heading').textContent.includes('已完成')`)
  assert.equal(requests.length,3)
  assert.equal(maximumActive,1)
  assert.equal(await ev(`document.querySelector('.ai-result-text').readOnly`),false)
  await click('替换选区')
  assert.equal(await ev('editor().state.doc.toString()'),original.replace('风很冷。灯很暗。','风很暖。灯很亮。'))
  await capture('cancel-and-retry-success')
  writeFileSync(resolve(run,'result.json'),JSON.stringify({result:'PROVIDER_LIFECYCLE_PASS',responsiveMs,requests:requests.length,maximumActive,cancelled,paidGeneration:false},null,2))
  console.log('PROVIDER_LIFECYCLE_PASS '+run+' native IPC '+responsiveMs+'ms')
} catch(error) {
  if(socket){try{await capture('failure');console.log(await ev('document.body.innerText.slice(-3500)'))}catch{/* app exited */}}
  throw error
} finally { socket?.close();child.kill();server.close() }

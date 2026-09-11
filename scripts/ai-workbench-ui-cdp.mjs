/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const run = resolve('tmp/ai-workbench-ui-' + Date.now())
mkdirSync(run, { recursive: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const child = spawn(resolve('src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9468' } })
let socket, seq = 0
const pending = new Map()
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const ev = async expression => { const result = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result?.value }
const saveChecked = async ({ input }) => {
  const disk = await call('get_document', { input: { projectPath: input.projectPath, nodeId: input.nodeId } })
  return call('save_document_checked', { input, expectedContent: disk.content })
}
const call = (name, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`)
const click = text => ev(`(()=>{const scope=[...document.querySelectorAll('[role="dialog"]')].at(-1)??document;const e=[...scope.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(text)});if(!e)throw Error('missing '+${JSON.stringify(text)});e.click()})()`)
const waitFor = async (expression, count = 100) => { for (let i=0;i<count;i++) { if (await ev(expression)) return; await sleep(250) } throw Error('Timed out: '+expression) }
const select = (label, value) => ev(`(()=>{const label=[...document.querySelectorAll('label')].find(e=>e.textContent.includes(${JSON.stringify(label)}));const e=label?.querySelector('select')??document.getElementById(label?.htmlFor);if(!e)throw Error('missing select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
const setField = (selector,value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing field');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
const capture = async name => { const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(run,name+'.png'),Buffer.from(shot.data,'base64')) }
try {
  let target
  for(let i=0;i<100;i++){try{target=(await(await fetch('http://127.0.0.1:9468/json/list')).json()).find(item=>item.type==='page');if(target)break}catch{/* startup */}await sleep(200)}
  assert.ok(target);socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data),task=pending.get(message.id);if(task){pending.delete(message.id);if(message.error)task.reject(Error(message.error.message));else task.resolve(message.result)}})
  await cmd('Runtime.enable');await waitFor('!!window.__TAURI_INTERNALS__?.invoke')
  const projectPath=resolve(run,'project')
  const data=await call('create_project',{input:{path:projectPath,title:'AI 工作台验收',author:'',genre:'',description:'',targetWords:1000}})
  const volume=data.nodes.find(node=>node.kind==='volume'),chapter=data.nodes.find(node=>node.kind==='chapter')
  await saveChecked({input:{projectPath,nodeId:chapter.id,content:'# 雨夜来信\n\n我推开旧书店的门，柜台上放着一封写有我名字的信。',reason:'合成测试'}})
  for(let i=0;i<25;i++) await call('create_node',{input:{projectPath,kind:'chapter',title:'参考章节 '+(i+2),parentId:volume.id}})
  await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{path:projectPath,title:'AI 工作台验收',updatedAt:''}]))});location.reload()`)
  await sleep(800);await waitFor(`!!document.querySelector('.recent-project')`);await ev(`document.querySelector('.recent-project').click()`)
  await waitFor(`!!document.querySelector('.cm-content')`)
  await ev(`(()=>{const e=[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.includes('AI 辅助'));e.closest('details')?.setAttribute('open','');e.click()})()`)
  await waitFor(`!!document.querySelector('.ai-workbench')`)
  assert.equal(await ev(`!!document.querySelector('.prompt-preset-manager')`),false)
  await setField('.ai-instruction-input','保持第一人称，增加悬念，不改变已有设定。')
  await click('预览上下文');await waitFor(`!!document.querySelector('.ai-request-dialog [role="dialog"]')`)
  assert.ok(await ev(`document.querySelector('.ai-preview-panel').textContent.includes('第一人称')`))
  await capture('request-preview')
  await click('确认运行');await waitFor(`!!document.querySelector('.ai-result-text')`)
  assert.ok(await ev(`document.querySelector('.ai-result-text').value.includes('本地')`))
  const records=[]
  for(const [width,height] of [[1440,900],[1100,750],[1100,650]]){
    await cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(250)
    const dimensions=await ev(`(()=>{const r=e=>{const v=e.getBoundingClientRect();return {x:v.x,y:v.y,right:v.right,bottom:v.bottom,width:v.width,height:v.height}};return {left:r(document.querySelector('.ai-compose-panel')),right:r(document.querySelector('.ai-output-panel')),generate:r(document.querySelector('.ai-compose-footer')),apply:r(document.querySelector('.ai-result-actions')),scrollHeight:document.querySelector('.ai-compose-scroll').scrollHeight,clientHeight:document.querySelector('.ai-compose-scroll').clientHeight,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1}})()`)
    assert.ok(dimensions.right.x>dimensions.left.right,'two columns');assert.equal(dimensions.bodyOverflow,false)
    assert.ok(await ev(`Array.from(document.querySelectorAll('.ai-task-picker > button')).every(e=>e.getBoundingClientRect().height<40)`),'quick task labels stay on one line')
    assert.ok(dimensions.generate.bottom<=height-20,'run buttons visible');assert.ok(dimensions.apply.bottom<=height-20,'result actions visible')
    assert.ok(dimensions.scrollHeight>dimensions.clientHeight,'long context scrolls')
    await ev(`document.querySelector('.ai-compose-scroll').scrollTop=400`)
    assert.ok(Math.abs((await ev(`document.querySelector('.ai-output-panel').getBoundingClientRect().y`))-dimensions.right.y)<1)
    await ev(`document.querySelector('.ai-compose-scroll').scrollTop=0`)
    records.push({width,height,...dimensions});await capture('workbench-'+width+'x'+height)
  }
  await click('使用模板');await waitFor(`!!document.querySelector('.ai-template-dialog [role="dialog"]')`)
  await setField('.prompt-preset-editor input[placeholder="人物 OOC 检查"]','未保存的工作台模板')
  await setField('.prompt-template-text','请分析 {{currentChapter}}')
  await click('关闭');assert.equal(await ev(`!!document.querySelector('[role="dialog"]')`),false)
  await click('使用模板');assert.equal(await ev(`document.querySelector('.prompt-preset-editor input').value`),'未保存的工作台模板')
  await capture('template-draft');await click('关闭')
  await select('AI 模式','provider');await click('连接设置')
  await setField('input[placeholder="留空使用本地离线模式"]','https://example.invalid/v1')
  await setField('input[type="password"]','synthetic-key')
  await click('关闭');await click('连接设置')
  assert.equal(await ev(`document.querySelector('input[type="password"]').value`),'synthetic-key')
  await click('关闭');await select('AI 模式','offline')
  await click('运行辅助');await waitFor(`!!document.querySelector('.ai-result-text')`)
  await ev(`document.documentElement.dataset.theme='dark'`);await sleep(350);await capture('workbench-dark')
  const before=(await call('get_document',{input:{projectPath,nodeId:chapter.id}})).content
  const generated=await ev(`document.querySelector('.ai-result-text').value`)
  await click('追加到正文')
  await waitFor(`window.__TAURI_INTERNALS__.invoke('get_document',${JSON.stringify({input:{projectPath,nodeId:chapter.id}})}).then(d=>d.content.includes(${JSON.stringify(generated.trim())})&&d.content.startsWith(${JSON.stringify(before.trimEnd())})&&d.content.length>${before.length})`)
  assert.ok(before.includes('旧书店'))
  writeFileSync(resolve(run,'result.json'),JSON.stringify({result:'AI_WORKBENCH_UI_PASS',records,subscriptionGeneration:false},null,2))
  console.log('AI_WORKBENCH_UI_PASS '+run)
}finally{socket?.close();child.kill()}

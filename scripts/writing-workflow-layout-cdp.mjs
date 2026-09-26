/* global console, fetch, process, setTimeout, WebSocket, Buffer */
import {spawn,execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const dir=resolve('tmp/workflow-layout-check');mkdirSync(dir,{recursive:true})
const pause=ms=>new Promise(r=>setTimeout(r,ms));let browser,server,ws,id=0;const pending=new Map()
const cmd=(method,params={})=>new Promise((res,rej)=>{const n=++id;pending.set(n,{res,rej});ws.send(JSON.stringify({id:n,method,params}))})
const evaluate=async expression=>{const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
try{
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1437','--strictPort'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
 server.stdout.on('data',d=>console.log(String(d)));server.stderr.on('data',d=>console.log(String(d)))
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:1437')).ok)break}catch{ /* Waiting for the isolated server. */ }await pause(200)}
 browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9477','--user-data-dir='+resolve('src-tauri/target/workflow-layout-profile'),'http://127.0.0.1:1437'],{windowsHide:true,stdio:'ignore'})
 let page;for(let i=0;i<80;i++){try{page=(await(await fetch('http://127.0.0.1:9477/json/list')).json()).find(p=>p.type==='page');if(page)break}catch{ /* Waiting for the isolated server. */ }await pause(200)}
 assert.ok(page);ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);if(m.error)p.rej(Error(m.error.message));else p.res(m.result)}})
 for(let i=0;i<80;i++){if(await evaluate("location.origin==='http://127.0.0.1:1437' && !!document.querySelector('#root')"))break;await pause(150)}
 await pause(3000)
 await evaluate(`(async()=>{const {useAppStore:s}=await import('/src/stores/app-store.ts');window.layoutStore=s;await s.getState().createProject({path:'browser-layout-'+Date.now(),title:'布局验收',author:'',description:'',genre:'',targetWords:1000});})()`)
 const rows=[]
 for(const width of [1100,1440,1920])for(const theme of ['light','dark']){
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false})
  await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`)
  for(const view of ['manuscript-import','chapter-memory','annotation']){
   await evaluate(`window.layoutStore.setState({activeView:${JSON.stringify(view)}})`)
   await pause(250)
   const geometry=await evaluate(`(()=>{
    const root=document.querySelector('.workspace'),pane=root.querySelector('.workspace-view'),region=root.querySelector('.memory-editor-region')||pane,detail=region.querySelector('.archive-editor-detail'),header=pane.querySelector('.view-header');
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,right:r.right}};
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
    const bounds=rect(root),overflows=[...pane.querySelectorAll('input,textarea,select,button,label,p,h1,h2')].filter(visible).filter(e=>{const r=rect(e);return r.x<bounds.x-1||r.right>bounds.right+1}).map(e=>({tag:e.tagName,text:e.textContent.slice(0,80),...rect(e)}));
    return {region:rect(region),detail:rect(detail),header:rect(header),overflows,scrollWidth:pane.scrollWidth,clientWidth:pane.clientWidth}
   })()`)
   assert.ok(Math.abs(geometry.detail.x+geometry.detail.width/2-geometry.region.x-geometry.region.width/2)<1,'center '+view)
   if(view!=='chapter-memory')assert.ok(Math.abs(geometry.header.x-geometry.detail.x)<1,'header alignment '+view)
   assert.deepEqual(geometry.overflows,[],'overflow '+view)
   assert.ok(geometry.scrollWidth<=geometry.clientWidth+1,'horizontal scroll '+view)
   rows.push({width,theme,view,...geometry})
   if(width===1100||width===1920){const shot=await cmd('Page.captureScreenshot',{format:'png'});writeFileSync(resolve(dir,view+'-'+width+'-'+theme+'.png'),Buffer.from(shot.data,'base64'))}
  }
 }
 writeFileSync(resolve(dir,'geometry.json'),JSON.stringify(rows,null,2));console.log('PASS: 18 workflow layouts; responsive centering, aligned headers and no field overflow')

}finally{ws?.close();for(const p of [browser,server])if(p?.pid)try{execFileSync('taskkill.exe',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'})}catch{ /* Waiting for the isolated server. */ }}

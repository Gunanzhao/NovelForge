/* global Buffer, console, fetch, process, setTimeout, WebSocket */
import { createServer } from 'node:http';
import assert from "node:assert/strict";
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const base = resolve('docs/audits/rc6'), run = resolve('tmp/rc6-live-' + Date.now());
mkdirSync(run, { recursive: true });
mkdirSync(resolve(base, 'screenshots'), { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let externalHits = 0;
const server = createServer((_request, response) => { externalHits++; response.end('NovelForge synthetic external navigation verification'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const externalUrl = 'http://127.0.0.1:' + server.address().port + '/';
const child = spawn(resolve('src-tauri/target/release/novelforge.exe'), [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: resolve(run, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9443' } });
let socket, seq = 0;
const pending = new Map();
const cmd = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => {
    const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
};
const saveChecked = async ({ input }) => {
  const disk = await call('get_document', { input: { projectPath: input.projectPath, nodeId: input.nodeId } })
  return call('save_document_checked', { input, expectedContent: disk.content })
}
const call = (name, args) => ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(name)},${JSON.stringify(args)})`);
const click = txt => ev(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(txt)});if(!e)throw Error('missing button '+${JSON.stringify(txt)});e.click()})()`);
const field = (sel, value) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('missing field');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const nav = async (txt) => { await ev(`(()=>{const e=[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(txt)}));if(!e)throw Error('missing nav');e.click()})()`); await sleep(160); };
const rows = [];
async function capture(name) { await sleep(180); const metrics = await ev(`(()=>{const b=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};const clipped=[...(document.querySelector('.modal-card') || document.querySelector('main')).querySelectorAll('button,input,textarea,select')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=55&&r.bottom<innerHeight-28}).flatMap(e=>{const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e.contains(hit)?[]:[{label:(e.textContent||e.placeholder||e.getAttribute('aria-label')||e.tagName).slice(0,70),rect:b(e),hit:hit?.className}]});return {width:innerWidth,height:innerHeight,bodyWidth:document.body.scrollWidth,workspace:b(document.querySelector('main')),columns:getComputedStyle(document.querySelector('.main-layout')).gridTemplateColumns,clipped}})()`); rows.push({ name, ...metrics }); const r = await cmd('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(base, 'screenshots', name + '.png'), Buffer.from(r.data, 'base64')); console.log(name, JSON.stringify(metrics)); }
try {
    let target;
    for (let n = 0; n < 100; n++) {
        try {
            target = (await fetch('http://127.0.0.1:9443/json/list').then(r => r.json())).find(p => p.type === 'page');
            if (target)
                break;
        }
        catch { /* Wait for WebView2 to start. */ }
        await sleep(250);
    }
    if (!target)
        throw Error('CDP unavailable');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(r => socket.addEventListener('open', r, { once: true }));
    socket.addEventListener('message', e => {
        const m = JSON.parse(e.data), p = pending.get(m.id);
        if (p) {
            pending.delete(m.id);
            if (m.error)
                p.reject(Error(m.error.message));
            else
                p.resolve(m.result);
        }
    });
    await cmd('Runtime.enable');
    const occupied = resolve(run, 'occupied'), sentinel = resolve(occupied, 'manuscript/volume_001/chapter_001.md');
    mkdirSync(resolve(occupied, 'manuscript/volume_001'), { recursive: true });
    writeFileSync(sentinel, 'EXISTING_MANUSCRIPT_MUST_SURVIVE');
    await assert.rejects(call('create_project', { input: { path: occupied, title: 'Existing', author: '', genre: '', description: '', targetWords: 1000 } }));
    assert.equal(readFileSync(sentinel, 'utf8'), 'EXISTING_MANUSCRIPT_MUST_SURVIVE');
    console.log('EXISTING_MANUSCRIPT_PROTECTED');
    const projectPath = resolve(run, 'project');
    let p = await call('create_project', { input: { path: projectPath, title: '全量审查合成项目', author: '审查', genre: '测试', description: '独立合成测试数据', targetWords: 10000 } });
    const chapter = p.nodes.find(n => n.kind === 'chapter');
    await saveChecked( { input: { projectPath, nodeId: chapter.id, content: '# 测试正文\n\n林月在青山城遇见苏晴。[[林月]]拿起书。\n\n## 内部标题\n\n这里只使用合成文本。', reason: 'audit' } });
    for (const [kind, title, content] of [['character', '林月', { description: '已保存人物说明' }], ['character', '苏晴', {}], ['location', '青山城', {}], ['world', '星河法则', {}], ['timeline', '初次相遇', { storyDate: '1', chapterId: chapter.id }], ['foreshadowing', '遗失的信', { status: 'planted', chapterId: chapter.id }], ['story-arc', '寻找失落之城', { status: 'active', chapterIds: [chapter.id], milestones: [] }], ['inbox', '雨中的灵感', { body: '合成灵感', status: 'unprocessed' }]])
        p = await call('upsert_entity', { input: { projectPath, kind, title, content, tags: [] } });
    const source = resolve(run, 'reference.txt');
    writeFileSync(source, 'SYNTHETIC REFERENCE');
    p = await call('import_attachment', { input: { projectPath, sourcePath: source, description: '初始附件说明' } });
    const attachment = p.entities.find(e => e.kind === 'attachment');
    p = await call('upsert_entity', { input: { projectPath, kind: 'attachment', id: attachment.id, title: attachment.title, content: { ...attachment.content, chapterId: chapter.id, description: 'RC6_ATTACHMENT_DESCRIPTION' }, tags: ['附件'] } });
    const codeBody = '# 第一章\n\n````text\nCODE_A\n```\n# INSIDE_CODE\n````\nAFTER_CODE';
    await saveChecked( { input: { projectPath, nodeId: chapter.id, content: codeBody, reason: 'regression' } });
    const exported = await call('export_project', { input: { projectPath, format: 'html', includeToc: false } });
    const html = readFileSync(exported, 'utf8');
    writeFileSync(resolve(base, 'fence-export.html'), html);
    assert.ok(!/<h[1-6][^>]*>INSIDE_CODE<\/h[1-6]>/.test(html));
    assert.ok(!/<pre><code[^>]*>[^<]*AFTER_CODE/.test(html));
    assert.ok(html.includes('CODE_A'));
    console.log('LONG_FENCE_EXPORT_OK');
    await saveChecked( { input: { projectPath, nodeId: chapter.id, content: '# 测试正文\n\n林月在青山城遇见苏晴。[[林月]]拿起书。\n\n[外链测试](' + externalUrl + ')\n\n## 内部标题\n\n这里只使用合成文本。', reason: 'regression' } });
    await ev(`localStorage.setItem('novelforge:recent-projects',${JSON.stringify(JSON.stringify([{ path: projectPath, title: '全量审查合成项目', updatedAt: '' }]))});location.reload()`);
    await sleep(800);
    await ev(`document.querySelector('.recent-project').click()`);
    await sleep(800);
    await nav('人物');
    await ev(`document.querySelector('.entity-list-item').click()`);
    await sleep(120);
    await field('input[placeholder="输入人物名称"]', '人物未保存草稿哨兵');
    await ev(`window.dispatchEvent(new Event('novelforge:toggle-chapter-checklist'))`);
    await sleep(700);
    assert.equal(await ev(`document.querySelector('input[placeholder="输入人物名称"]').value`), '人物未保存草稿哨兵');
    await capture('entity-draft-preserved');
    console.log('ENTITY_DRAFT_PRESERVED');
    await nav('正文');
    assert.ok(await ev(`document.querySelector('.linked-attachments')?.textContent.includes('reference.txt')`));
    await ev(`document.querySelector('.linked-attachments button').click()`);
    await sleep(200);
    assert.equal(await ev(`document.querySelector('.attachments-view textarea').value`), 'RC6_ATTACHMENT_DESCRIPTION');
    console.log('CHAPTER_ATTACHMENT_NAVIGATION_OK');
    await nav('AI 辅助');
    await ev(`(()=>{const e=[...document.querySelectorAll('.ai-context-item')].find(e=>e.textContent.includes('reference.txt'));if(!e)throw Error('missing attachment context');e.querySelector('input').click()})()`);
    await click('预览上下文');
    await sleep(400);
    assert.ok(await ev(`document.querySelector('.ai-preview-panel').textContent.includes('RC6_ATTACHMENT_DESCRIPTION')`));
    assert.ok(!await ev(`document.querySelector('.ai-preview-panel').textContent.includes('SYNTHETIC REFERENCE')`));
    console.log('EXPLICIT_ATTACHMENT_TEXT_CONTEXT_OK');
    for (const [w, h] of [[1440, 900], [1366, 768], [1100, 650]]) {
        await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        for (const [i, label] of ['总览', '正文', '写作规划', '人物', '地点', '世界观 Wiki', '时间线', '伏笔', '剧情线', '灵感箱', '人物关系图', '资料附件', '一致性检查', '详细统计', 'AI 辅助'].entries()) {
            await nav(label);
            await capture(`${w}-${i}`);
        }
        await click('导出');
        await capture(`${w}-export`);
        await ev(`document.querySelector('.modal-header button').click()`);
    }
    await nav('资料附件');
    await field('input[placeholder="搜索附件名称或说明"]', 'NO_MATCH_AUDIT');
    await capture('attachment-filter-empty');
    assert.equal(await ev(`document.querySelectorAll('.attachments-view textarea').length`), 0);
    console.log('ATTACHMENT_FILTER_EMPTY_OK');
    await nav('正文');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await ev(`document.querySelector('.panel-resize-handle.sidebar').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:272}));window.dispatchEvent(new PointerEvent('pointermove',{clientX:1222}));window.dispatchEvent(new PointerEvent('pointerup'))`);
    await capture('resize-clamped');
    assert.ok(rows.at(-1).workspace.w >= 480);
    assert.ok(Number(JSON.parse(await ev(`localStorage.getItem('novelforge:workspace-preferences:v1')`)).sidebarWidth) <= 420);
    console.log('SIDEBAR_RESIZE_CLAMPED');
    await ev('location.reload()');
    await sleep(600);
    await ev(`document.querySelector('.recent-project').click()`);
    await sleep(600);
    await capture('resize-after-reload');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1100, height: 650, deviceScaleFactor: 1, mobile: false });
    await ev(`localStorage.setItem('novelforge:workspace-preferences:v1',JSON.stringify({...JSON.parse(localStorage.getItem('novelforge:workspace-preferences:v1')),sidebarWidth:420,inspectorWidth:420}));location.reload()`);
    await sleep(600);
    await ev(`document.querySelector('.recent-project').click()`);
    await sleep(600);
    for (const label of ['资料附件', '时间线', '写作规划', 'AI 辅助']) {
        await nav(label);
        await capture('max-panels-' + label);
        assert.ok(rows.at(-1).workspace.w >= 480);
    }
    for (const label of ['资料附件', '时间线', '写作规划']) {
        await nav(label);
        await ev(`document.querySelector('main textarea')?.scrollIntoView({block:'center'})`);
        await capture('scrolled-details-' + label);
        assert.deepEqual(rows.at(-1).clipped, []);
    }
    await ev(`document.querySelector('button[aria-label="收起左栏"]').click();document.querySelector('button[aria-label="收起辅助栏"]').click()`);
    await capture('both-panels-collapsed');
    assert.ok(rows.at(-1).workspace.w >= 1099);
    await ev(`document.querySelector('button[aria-label="展开左栏"]').click();document.querySelector('button[aria-label="展开辅助栏"]').click()`);
    for (const theme of ['dark', 'light']) {
        await ev(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('button[aria-label="切换主题"]').click()`);
        for (const label of ['资料附件', '时间线', '写作规划']) {
            await nav(label);
            await capture(theme + '-' + label);
        }
    }
    await nav('正文');
    const originalUrl = await ev('location.href');
    await ev(`location.href='https://example.com/rc6-navigation-block'`);
    await sleep(400);
    assert.equal(await ev('location.href'), originalUrl);
    assert.ok(await ev(`Boolean(document.querySelector('.app-shell'))`));
    console.log('MAIN_NAVIGATION_BLOCKED');
    await click('预览');
    await ev(`document.querySelector('a[href="${externalUrl}"]').click()`);
    for (let i = 0; i < 40 && !externalHits; i++)
        await sleep(250);
    assert.ok(externalHits > 0, 'System browser must request the local synthetic URL');
    assert.equal(await ev('location.href'), originalUrl);
    assert.ok(await ev(`Boolean(document.querySelector('.app-shell'))`));
    console.log('EXTERNAL_LINK_SYSTEM_BROWSER_OK');
    await click('编辑');
    await ev(`[...document.querySelectorAll('.tree-row button[title="展开"]')].forEach(button=>button.click())`);
    await sleep(120);
    await ev(`document.querySelector('.cm-content').focus()`);
    await cmd('Input.insertText', { text: 'RC6_DIRTY_COPY_SENTINEL' });
    assert.ok(!readFileSync(resolve(projectPath, chapter.filePath), 'utf8').includes('RC6_DIRTY_COPY_SENTINEL'), 'Copy must start before autosave');
    await ev(`[...document.querySelectorAll('.tree-row')].find(row=>row.textContent.includes(${JSON.stringify(chapter.title)})).querySelector('button[title="复制节点"]').click()`);
    await sleep(80);
    await field('.modal-card input', 'RC6_DIRTY_COPY');
    await ev(`[...document.querySelectorAll('.modal-footer button')].find(e=>e.textContent.trim()==='复制').click()`);
    await sleep(700);
    p = await call('open_project', { path: projectPath });
    const copied = p.nodes.find(n => n.title === 'RC6_DIRTY_COPY');
    assert.equal(copied?.kind, 'chapter');
    assert.ok(readFileSync(resolve(projectPath, copied.filePath), 'utf8').includes('RC6_DIRTY_COPY_SENTINEL'));
    console.log('UNSAVED_DOCUMENT_COPY_OK');
    writeFileSync(resolve(base, 'layout-metrics.json'), JSON.stringify(rows, null, 2));
    writeFileSync(resolve(base, 'live-project.json'), JSON.stringify({ run, projectPath, chapter, pid: child.pid }, null, 2));
    assert.ok(rows.every(r => r.bodyWidth <= r.width + 1 && r.workspace.w >= 479));
    assert.ok(rows.every(r => r.clipped.length === 0), 'All currently visible controls must be unobscured');
    console.log('RC6_REGRESSION_DONE', projectPath);
}
finally {
    socket?.close();
    child.kill();
    server.closeAllConnections();
    server.close();
}

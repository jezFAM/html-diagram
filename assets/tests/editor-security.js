// Playwright MCP browser_run_code_unsafe filename: this file.
// Serve the repo at 127.0.0.1:18768; set page.securityBaseline=true for the pre-fix run.
// Uses an isolated context and intercepted loopback HTTP; no external requests escape.
(async function (page) {
  const baseline = page.securityBaseline === true;
  const out = page.securityEvidenceDir || '.omo/evidence/editor-security';
  const engine = await (await fetch('http://127.0.0.1:18768/assets/fig-editor.js')).text();
  const css = await (await fetch('http://127.0.0.1:18768/assets/fig-editor.css')).text();
  const context = await page.context().browser().newContext({ viewport: { width: 1200, height: 800 }, acceptDownloads: true });
  const requests = [], consoleMessages = [], errors = [], checks = {};
  const origin = 'http://127.0.0.1:18768';
  const canary = `<div class="fig-node" id="evil" style="left:20px;top:200px;width:180px;height:80px;background-image:url('${origin}/canary-css')" onclick="window.__canary.push('click')"><b>Safe text</b><img src="${origin}/canary-image" onerror="window.__canary.push('image')"><iframe src="${origin}/canary-frame"></iframe><svg onload="window.__canary.push('svg')"><use href="${origin}/canary-use#x"/><animate attributeName="href" values="javascript:window.__canary.push('animate')"/></svg><a href="java&#10;script:window.__canary.push('url')">unsafe link</a><span style="background-image:image-set('${origin}/canary-imageset' 1x)">image set</span><span style="background-image:u\\72l('${origin}/canary-escape')">escaped CSS</span><script>window.__canary.push('script')</script></div><img src="${origin}/canary-detached" onerror="window.__canary.push('detached')">`;
  const normal = '<div class="fig-canvas" data-size="1000x500"><div class="fig-node" id="a" style="left:40px;top:40px;width:180px;height:80px"><b>Alpha</b><span style="color:rgb(20, 40, 60);font-style:italic"> formatted</span><svg width="24" height="24" viewBox="0 0 24 24"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs><circle cx="12" cy="12" r="10" fill="url(#paint)"/><use href="#dot"/><path id="dot" d="M1 1L2 2"/></svg><a href="#a">internal</a></div><div class="fig-node" id="b" style="left:500px;top:40px;width:180px;height:80px">Beta</div><div class="fig-edge" id="e" data-from="a" data-to="b" data-arrow="none" data-curve="0.1" data-anchor-from="right" data-anchor-to="left"></div></div>';
  const history = JSON.stringify([{ts:'2026-10-02T00:00:00Z',title:'Synthetic history',html:normal+canary}]).replace(/</g, '\\u003c');
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Editor security fixture</title><style>body{font-family:Arial;padding:20px}.fig-node{background:#fff;border:1px solid #777}</style><style id="fig-editor-css">'+css+'</style></head><body>'+normal+'<script id="fig-history" type="application/json">'+history+'</script><script>'+engine+'</script></body></html>';
  await context.addInitScript(() => { window.__canary = []; });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if(url === origin+'/fixture.html') return route.fulfill({contentType:'text/html',body:html});
    requests.push(url);
    return route.fulfill({status:200,contentType:'text/plain',body:'synthetic resource'});
  });
  const tab = await context.newPage();
  tab.on('console', m => { if(['error','warning'].includes(m.type())) consoleMessages.push({type:m.type(),text:m.text()}); });
  tab.on('pageerror', e => errors.push(String(e)));
  const settle = () => tab.waitForTimeout(250);
  const paste = payload => tab.evaluate(payload => {
    const data = new DataTransfer(); data.setData('text/plain','FIG-CLIP:'+JSON.stringify(payload));
    document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  }, payload);
  try {
    await tab.goto(origin+'/fixture.html');
    await tab.evaluate(() => FigEditor.setEdit(true));
    await paste({fig:'clipboard',v:1,nodes:[{id:'evil',html:canary}],edges:[]});
    await tab.evaluate(() => document.querySelector('.fig-selected').click());
    await settle();
    checks.paste = {events:await tab.evaluate(()=>window.__canary.slice()),requests:requests.slice()};
    await tab.locator('#figHistory').click();
    await tab.locator('.fig-hist-item').first().click();
    await settle();
    await tab.getByText('이 버전으로 복원',{exact:true}).click();
    await settle();
    checks.history = {events:await tab.evaluate(()=>window.__canary.slice()),requests:requests.slice(),safeText:await tab.locator('#evil b').textContent()};
    if (!baseline) {
      if (requests.length || checks.history.events.length) throw new Error('Canary executed or requested a resource');
      const active = await tab.evaluate(() => [...document.querySelectorAll('.fig-node, .fig-node *')].filter(el=>['SCRIPT','IFRAME','ANIMATE'].includes(el.tagName.toUpperCase()) || [...el.attributes].some(a=>/^on/i.test(a.name)||(/^(?:href|xlink:href)$/.test(a.name)&&!a.value.startsWith('#')))).length);
      if(active) throw new Error('Active markup survived restoration');
      await tab.evaluate(() => { window.__copied = ''; document.addEventListener('copy',event=>{event.preventDefault();window.__copied=document.activeElement.value;}); FigEditor.select(document.querySelector('#a')); });
      await tab.keyboard.press('Control+c');
      const copied = await tab.evaluate(()=>window.__copied);
      if(!copied.startsWith('FIG-CLIP:')) throw new Error('Native copy did not produce a payload');
      const payload = JSON.parse(copied.slice(9));
      payload.nodes.push({id:'b',html:await tab.locator('#b').evaluate(el=>el.outerHTML)});
      payload.edges.push({html:await tab.locator('#e').evaluate(el=>el.outerHTML)});
      const before = await tab.locator('.fig-node').count();
      await paste(payload);
      checks.normal = await tab.evaluate(() => {
        const nodes=FigEditor.selection().filter(el=>el.classList.contains('fig-node')), edge=FigEditor.selection().find(el=>el.classList.contains('fig-edge'));
        const a=nodes[0],circle=a.querySelector('circle');
        return {count:nodes.length,bold:a.querySelector('b').textContent,italic:a.querySelector('span').style.fontStyle,svg:!!circle,localSvg:circle.getAttribute('fill')==='url(#'+a.querySelector('linearGradient').id+')',localLink:a.querySelector('a').getAttribute('href')==='#'+a.id,uniqueIds:new Set([...document.querySelectorAll('[id]')].map(el=>el.id)).size===document.querySelectorAll('[id]').length,edgeRemapped:edge.dataset.from===nodes[0].id&&edge.dataset.to===nodes[1].id,rendered:!!edge._geom};
      });
      if(checks.normal.count!==2||checks.normal.bold!=='Alpha'||checks.normal.italic!=='italic'||Object.values(checks.normal).some(v=>v===false)) throw new Error('Normal formatting, SVG or references changed');
      await tab.keyboard.press('Control+z');
      checks.undo = await tab.locator('.fig-node').count()===before;
      await tab.keyboard.press('Control+Shift+z');
      checks.redo = await tab.locator('.fig-node').count()===before+2;
      if(!checks.undo||!checks.redo) throw new Error('Undo/redo failed');
      await tab.evaluate(()=>{window.showSaveFilePicker=undefined;});
      const downloaded=tab.waitForEvent('download');
      await tab.locator('#figSave').click();
      const download=await downloaded, saved=out+'/saved.html';
      await download.saveAs(saved);
      const stream=await download.createReadStream(), chunks=[];
      for await (const chunk of stream) chunks.push(chunk);
      const savedHtml=Buffer.concat(chunks).toString('utf8');
      checks.save={path:saved,bytes:Buffer.byteLength(savedHtml),route:'actual browser download; OS File System Access picker not exercised'};
      await context.unroute('**/*');
      await context.route('**/*',async route=>{
        if(route.request().url()===origin+'/saved.html') return route.fulfill({contentType:'text/html',body:savedHtml});
        requests.push(route.request().url()); return route.fulfill({contentType:'text/plain',body:'synthetic resource'});
      });
      await tab.goto(origin+'/saved.html');
      await tab.evaluate(()=>FigEditor.setEdit(true));
      checks.reopen={nodes:await tab.locator('.fig-node').count(),history:await tab.evaluate(()=>FigEditor.history().length)};
      await tab.locator('#figHistory').click();
      await tab.locator('.fig-hist-item').first().click();
      await tab.getByText('이 버전으로 복원',{exact:true}).click();
      await settle();
      checks.reopen.editing=await tab.evaluate(()=>FigEditor.isEditing());
      checks.reopen.events=await tab.evaluate(()=>window.__canary.slice());
      if(checks.reopen.nodes!==before+2||!checks.reopen.history||!checks.reopen.editing||checks.reopen.events.length||requests.length) throw new Error('Save/reopen or native history failed');
    }
    await tab.screenshot({path:out+(baseline?'/baseline.png':'/browser.png'),fullPage:true});
    const report={baseline,pass:baseline ? checks.paste.events.length>0&&checks.history.events.length>0&&requests.length>0 : !errors.length,checks,requests,consoleMessages,errors};
    if(!report.pass) throw new Error('Browser check failed');
    return report;
  } catch(error) {
    return {pass:false,error:String(error),checks,requests,consoleMessages,errors};
  } finally { await context.close(); }
})

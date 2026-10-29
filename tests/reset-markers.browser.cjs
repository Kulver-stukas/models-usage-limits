/* Real DOM/canvas and popup checks with synthetic accounts, no live sessions. */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const {chromium}=require(process.env.METER_PLAYWRIGHT_MODULE||'playwright');
const extension=path.resolve(__dirname,'../extension');
const image=colour=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${colour}"/></svg>`);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.METER_CHROMIUM_PATH?{executablePath:process.env.METER_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try{
  const page=await browser.newPage({viewport:{width:680,height:780}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Original chat title</title></head><body><main id="popup"></main></body></html>'}));
  await page.goto('https://chatgpt.com/c/synthetic');
  const blue=image('#1122aa'),red=image('#aa2211');
  await page.evaluate(href=>{const n=document.createElement('link');n.id='native-icon';n.rel='icon';n.href=href;document.head.append(n);},blue);
  for(const f of ['shared.js','favicon.js','ui.js'])await page.addScriptTag({path:path.join(extension,f)});
  await page.evaluate(()=>{window.marker=UsageFavicon.create();marker.set(true);});
  await page.waitForFunction(()=>document.querySelector('#native-icon').href.startsWith('data:image/png'));
  assert.equal(await page.title(),'Original chat title');
  const pixels=await page.evaluate(async()=>{const img=new Image();img.src=document.querySelector('#native-icon').href;await img.decode();const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.drawImage(img,0,0);return {base:[...x.getImageData(3,3,1,1).data],dot:[...x.getImageData(24,24,1,1).data]};});
  assert.deepEqual(pixels.base,[17,34,170,255]);assert.deepEqual(pixels.dot,[34,166,106,255]);
  const previous=await page.locator('#native-icon').getAttribute('href');
  await page.evaluate(href=>{document.title='A new chat title from the provider';document.querySelector('#native-icon').href=href;},red);
  await page.waitForFunction(old=>document.querySelector('#native-icon').href.startsWith('data:image/png')&&document.querySelector('#native-icon').href!==old,previous);
  await page.evaluate(()=>marker.set(false));assert.equal(await page.locator('#native-icon').getAttribute('href'),red);assert.equal(await page.title(),'A new chat title from the provider');
  assert.equal(await page.locator('#native-icon').getAttribute('type'),null);assert.equal(await page.locator('#native-icon').getAttribute('sizes'),null);
  assert.equal(await page.locator('[data-usage-meter-icon]').count(),0);
  await page.evaluate(()=>{marker.set(true);marker.set(false);});
  assert.equal(await page.locator('#native-icon').getAttribute('href'),red);
  await page.evaluate(()=>{marker.set(true);});await page.waitForFunction(()=>document.querySelector('[data-usage-meter-icon]'));
  await page.evaluate(()=>marker.destroy());assert.equal(await page.locator('#native-icon').getAttribute('href'),red);
  // The marker works without the floating widget and restores on reinjection.
  await page.evaluate(()=>{
   const v={provider:'chatgpt',resetMarker:true,revision:1},listeners=[];window.sent=[];
   globalThis.chrome={runtime:{id:'test',getManifest:()=>({version:'0.3.7'}),sendMessage:async m=>{sent.push(m);return {ok:true,tabId:1,view:v};}},
    storage:{local:{get:async()=>({settings:{widget:false},tabViews:{1:v}})},onChanged:{addListener:f=>listeners.push(f),removeListener:f=>listeners.splice(listeners.indexOf(f),1)}}};
  });
  await page.addScriptTag({path:path.join(extension,'content.js')});await page.waitForFunction(()=>document.querySelector('[data-usage-meter-icon]'));
  assert.equal(await page.locator('#usage-meter-widget').count(),0);
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));});
  await page.waitForFunction(()=>sent.some(m=>m.type==='marker-seen'));
  await page.evaluate(()=>window.__usageMeterController.destroy());assert.equal(await page.locator('#native-icon').getAttribute('href'),red);
  assert.equal(await page.title(),'A new chat title from the provider');
  // Settings: current account only, no automatic selection, explicit reasons.
  await page.evaluate(()=>{
   const root=document.querySelector('#popup'),config={key:'gemini/account/pro',enabled:false,quotas:[
    {id:'five',label:'5-hour limit',eligible:true,selected:false},
    {id:'week',label:'Weekly limit',eligible:true,selected:false},
    {id:'count',label:'Deep research',eligible:false,selected:false,reason:'Only a remaining count is reported.'}]};
   window.v={provider:'gemini',snapshot:{plan:'pro',label:'PRO · demo'},resetMarkers:config};window.markerActions=[];
   window.renderSettings=()=>LimitsUI.render(root,v,{}, {markers:value=>{markerActions.push(value);config.enabled=value.enabled;for(const q of config.quotas)q.selected=value.quotas.includes(q.id);renderSettings();}},{screen:'reset-markers'});
   renderSettings();
  });
  const toggle=page.getByRole('checkbox',{name:'Green dot on reset',exact:true});assert(!await toggle.isChecked());assert(await page.getByRole('checkbox',{name:'5-hour limit',exact:true}).isDisabled());
  await toggle.check();await page.getByRole('checkbox',{name:'Weekly limit',exact:true}).check();
  assert(!await page.getByRole('checkbox',{name:'5-hour limit',exact:true}).isChecked());assert(await page.getByRole('checkbox',{name:'Deep research',exact:true}).isDisabled());
  assert.deepEqual(await page.evaluate(()=>markerActions.at(-1)),{key:'gemini/account/pro',enabled:true,quotas:['week']});
  await page.evaluate(()=>{v={provider:'claude',snapshot:{plan:'free',label:'CLAUDE · demo'},resetMarkers:{key:'claude/account/free',enabled:false,quotas:[{id:'five',label:'5-hour limit',eligible:false,reason:'This plan reports usage only after a chat reply.'}]}};renderSettings();});
  assert(await page.getByRole('checkbox',{name:'Green dot on reset',exact:true}).isDisabled());assert.match(await page.locator('#popup').textContent(),/after a chat reply/);
  if(process.env.METER_MARKER_PREVIEW){
   await page.evaluate(()=>{
    document.body.innerHTML='<main style="display:flex;gap:24px;padding:24px"></main>';document.body.style.cssText='margin:0;background:#eef2ef';
    for(const dark of [false,true]){const host=document.createElement('div');document.querySelector('main').append(host);host.attachShadow({mode:'open'});
      LimitsUI.render(host.shadowRoot,{provider:'gemini',snapshot:{plan:'pro',label:'PRO · demo'},resetMarkers:{key:'example',enabled:true,quotas:[{id:'five',label:'5-hour limit',eligible:true,selected:true},{id:'week',label:'Weekly limit',eligible:true,selected:false}]}},{},{},{screen:'reset-markers',dark});}
   });
   await fs.mkdir(path.dirname(process.env.METER_MARKER_PREVIEW),{recursive:true});await page.screenshot({path:process.env.METER_MARKER_PREVIEW,clip:{x:0,y:0,width:680,height:516}});
  }
  assert.deepEqual(errors,[]);console.log('PASS: favicon pixels, untouched titles, provider icon changes, cancellation, restoration, widget-off integration, acknowledgement and per-account quota settings.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

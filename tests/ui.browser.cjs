/* Synthetic browser UI tests; no signed-in accounts or real API requests. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.METER_PLAYWRIGHT_MODULE||'playwright');
const extension=path.resolve(__dirname,'../extension');require(path.join(extension,'shared.js'));
const C=globalThis.LimitsCore,now=Date.now();
function snapshot(provider){
  const base={plan:'pro',label:provider+' · test',errors:[]};
  if(provider==='claude')return {...base,usage:C.parseClaude({five_hour:{utilization:24,resets_at:new Date(now+3600000).toISOString()},seven_day:{utilization:15,resets_at:new Date(now+604800000).toISOString()},seven_day_sonnet:{utilization:10,resets_at:null}},now)};
  if(provider==='gemini')return {...base,usage:C.parseGemini([{data:{viewer:{rpcs:{getUsageInfo:{subscriptionTier:'TIER1',pools:[{poolType:'GXU_FIVE_HOURLY',percentageUsed:.63,gxu:{windowRefreshesAt:new Date(now+3600000).toISOString()}},{poolType:'GXU_WEEKLY',percentageUsed:.1,gxu:{windowRefreshesAt:new Date(now+604800000).toISOString()}}]}}}}}],now)};
  return {...base,plan:'team',usage:C.parseUsage({rate_limit:{primary_window:{used_percent:52,limit_window_seconds:18000,reset_after_seconds:5160},secondary_window:{used_percent:21,limit_window_seconds:604800,reset_after_seconds:439800}},rate_limit_reset_credits:{available_count:3,applicable_available_count:0}},now),init:C.parseInit({limits_progress:[{feature_name:'deep_research',remaining:25},{feature_name:'image_gen',remaining:120}]},now)};
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.METER_CHROMIUM_PATH?{executablePath:process.env.METER_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try{
  const context=await browser.newContext({viewport:{width:900,height:750},timezoneId:'Europe/Moscow',locale:'en-US'});
  const errors=[],messages=[],ids=new Map(),snaps=Object.fromEntries(['chatgpt','claude','gemini'].map(p=>[p,snapshot(p)]));let seq=1,rev=0,selected='chatgpt';
  const store={settings:{mode:'left',widget:false,widgetLevel:0},activeView:{provider:'chatgpt',snapshot:snaps.chatgpt,revision:++rev},tabViews:{}};
  const publish=async changes=>{await Promise.all(context.pages().filter(p=>!p.isClosed()).map(p=>p.evaluate(c=>window.__meterUpdate?.(c),changes)));};
  const publishData=async()=>{
   for(const [p,id] of ids){const provider=C.providerForURL(p.url());store.tabViews[id]={provider,snapshot:snaps[provider]||null,revision:++rev};}
   store.activeView={provider:selected,snapshot:snaps[selected]||null,unsupported:!selected,revision:++rev};
   await publish({tabViews:{newValue:store.tabViews},activeView:{newValue:store.activeView}});
  };
  await context.route('https://**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html class="light"><head><script>window.WIZ_global_data={"oPEP7c":"synthetic@example.test"}</script></head><body><main id="app"></main></body></html>'}));
  await context.exposeBinding('meterGet',()=>structuredClone(store));
  await context.exposeBinding('meterSend',async(source,m)=>{
   messages.push(m);
   if(m.type==='context'){
    if(!ids.has(source.page))ids.set(source.page,seq++);const id=ids.get(source.page),provider=C.providerForURL(source.page.url());
    const view={provider,snapshot:snaps[provider],revision:++rev};store.tabViews[id]=view;return {ok:true,tabId:id,view};
   }
   if(m.type==='popup')return {ok:true,view:store.activeView,settings:store.settings};
   if(m.type==='settings'){store.settings={...store.settings,...m.value};await publish({settings:{newValue:store.settings}});}
   if(m.type==='theme'){
    const id=ids.get(source.page),v=store.tabViews[id];if(v){v.dark=m.dark;v.revision=++rev;await publish({tabViews:{newValue:store.tabViews}});}
   }
   return {ok:true};
  });
  await context.addInitScript(()=>{
   const listeners=[];globalThis.chrome={runtime:{id:'test',getManifest:()=>({version:'0.3.0'}),sendMessage:m=>meterSend(m)},storage:{local:{get:()=>meterGet()},onChanged:{addListener:f=>listeners.push(f),removeListener:f=>{const i=listeners.indexOf(f);if(i>=0)listeners.splice(i,1);}}}};
   window.__meterUpdate=changes=>listeners.slice().forEach(f=>f(changes,'local'));
  });
  async function page(url,widget=true){
   const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);
   if(!widget)await p.addStyleTag({path:path.join(extension,'popup.css')});
   for(const f of ['shared.js','ui.js',widget?'content.js':'popup.js'])await p.addScriptTag({path:path.join(extension,f)});return p;
  }
  const popup=await page('https://extension.test/',false),one=await page('https://chatgpt.com/'),two=await page('https://chatgpt.com/c/second'),claude=await page('https://claude.ai/new'),gemini=await page('https://gemini.google.com/app');
  await popup.getByText('ChatGPT Usage',{exact:true}).waitFor();await popup.getByText('52% used',{exact:true}).waitFor();
  assert.equal(await popup.getByText('Deep research',{exact:true}).count(),0);assert.match(await popup.locator('.popup-window .reset').first().textContent(),/^Resets in/);
  await popup.getByRole('button',{name:'Settings',exact:true}).click();await popup.getByRole('checkbox',{name:'Floating widget',exact:true}).check();
  for(const p of [one,two])await p.getByText('25 left',{exact:true}).waitFor();
  await claude.getByText('Claude Usage',{exact:true}).waitFor();await gemini.getByText('Gemini Usage',{exact:true}).waitFor();
  assert.equal(await claude.locator('.bar-line .value').first().textContent(),'24%');assert.equal(await gemini.locator('.bar-line .value').first().textContent(),'63%');
  assert(!/Resets in/.test(await one.locator('.window-head .reset').first().textContent()));
  await popup.getByRole('button',{name:'Used',exact:true}).click();assert.equal(store.settings.mode,'used');assert.equal(await one.locator('.bar-line .value').first().textContent(),'52%');
  await one.getByRole('button',{name:'Show plan limits only',exact:true}).click();
  for(const p of [one,two,claude,gemini])await p.getByRole('button',{name:'Collapse to strip',exact:true}).waitFor();
  await one.getByRole('button',{name:'Collapse to strip',exact:true}).click();
  for(const p of [one,two,claude,gemini]){await p.locator('.strip').waitFor();assert.equal(await p.getByRole('progressbar').count(),0);assert((await p.locator('#usage-meter-widget').boundingBox()).height<=36);}
  await one.getByRole('button',{name:'Expand widget',exact:true}).click();await one.getByText('25 left',{exact:true}).waitFor();
  const fill=await one.locator('.fill').first().elementHandle();await popup.getByRole('button',{name:'Used',exact:true}).focus();snaps.chatgpt.usage.windows[0].used=60;await publishData();
  assert(await fill.evaluate(n=>n.isConnected));assert.equal(await popup.evaluate(()=>document.activeElement?.textContent),'Used');assert.equal(await claude.locator('.bar-line .value').first().textContent(),'24%');
  await one.bringToFront();await one.evaluate(()=>document.documentElement.className='dark');await one.locator('.meter.dark').waitFor();
  const head=await one.locator('.head').boundingBox();await one.mouse.move(head.x+125,head.y+15);await one.mouse.down();await one.mouse.move(head.x+100,head.y-10);
  snaps.chatgpt.usage.windows[0].used=61;await publishData();await one.mouse.up();await one.locator('.bar-line .value').first().filter({hasText:'61%'}).waitFor();
  await one.addScriptTag({path:path.join(extension,'content.js')});assert.equal(await one.locator('#usage-meter-widget').count(),1);
  await popup.getByRole('button',{name:'Back to usage',exact:true}).click();selected='claude';await publishData();await popup.getByText('Claude Usage',{exact:true}).waitFor();await popup.getByText('24% used',{exact:true}).waitFor();
  selected='gemini';await publishData();await popup.getByText('Gemini Usage',{exact:true}).waitFor();await popup.getByText('63% used',{exact:true}).waitFor();
  const native=await gemini.evaluate(()=>{const at=Date.now(),date=new Date(at+3600000);return {at,text:'Resets at '+date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})};});
  snaps.gemini.usage={...snaps.gemini.usage,source:'Gemini Usage page',fetchedAt:native.at,windows:[{id:'five',label:'5-hour limit',seconds:18000,main:true,used:0,resetAt:null,resetText:native.text}]};await publishData();
  await popup.getByText('0% used',{exact:true}).waitFor();assert.match(await popup.locator('.popup-window .reset').first().textContent(),/^Resets in/);assert.equal(await popup.getByText('Reset time unavailable',{exact:true}).count(),0);
  for(const w of snaps.claude.usage.windows)if(w.main)w.observation='event';
  snaps.claude.usage={...snaps.claude.usage,source:'Claude live event',observation:'event',fetchedAt:Date.now()-3600000};selected='claude';await publishData();await popup.getByText('Claude Usage',{exact:true}).waitFor();assert.equal(await popup.locator('.status.warn').count(),0);
  snaps.claude.usage.windows[0].resetAt=Date.now()-1000;await publishData();assert.equal(await popup.getByText('24% used',{exact:true}).count(),0);assert.equal(await popup.getByRole('progressbar').count(),2);
  selected=null;await publishData();await popup.getByText('Open a ChatGPT, Claude or Gemini tab to see its usage.',{exact:true}).waitFor();assert.equal(await popup.getByRole('progressbar').count(),0);assert(await popup.getByRole('button',{name:'Refresh usage'}).isDisabled());
  await one.getByRole('button',{name:'Hide widget',exact:true}).click();for(const p of [one,two,claude,gemini])await p.locator('#usage-meter-widget').waitFor({state:'detached'});
  assert.deepEqual(errors,[]);assert(!messages.some(m=>m.type==='ping'));
  console.log('PASS: provider headers, four independent widgets, popup active context, used/left, three collapse levels, theme, stable DOM, drag, reinjection and unsupported tab.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

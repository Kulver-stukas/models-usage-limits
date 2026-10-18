/* Browser-level data regressions with synthetic HTML, HTTP and stream frames. */
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),zlib=require('node:zlib');
const {chromium}=require(process.env.METER_PLAYWRIGHT_MODULE||'playwright');
const extension=path.resolve(__dirname,'../extension');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function v(n){const a=[];do{let b=n%128;n=Math.floor(n/128);a.push(b+(n?128:0));}while(n);return Buffer.from(a);}
const field=(n,bytes)=>Buffer.concat([v(n*8+2),v(bytes.length),bytes]);
const double=(n,value)=>{const b=Buffer.alloc(8);b.writeDoubleLE(value);return Buffer.concat([v(n*8+1),b]);};
function timelineFrame(used,reset,compressed=false){
 const stamp=Buffer.concat([v(8),v(reset)]),window=Buffer.concat([v(8),v(1),field(2,stamp),double(3,used)]);
 const entry=Buffer.concat([field(1,Buffer.from('5h')),field(2,window)]);
 let payload=field(1,field(4,field(13,entry)));if(compressed)payload=compressed==='deflate'?zlib.deflateSync(payload):zlib.gzipSync(payload);
 const header=Buffer.alloc(5);header[0]=compressed?1:0;header.writeUInt32BE(payload.length,1);return [...Buffer.concat([header,payload])];
}
(async()=>{
 const {scrapeGeminiPage}=await import(pathToFileURL(path.join(extension,'gemini-dom.mjs')));
 const {requestInTab,loadGemini}=await import(pathToFileURL(path.join(extension,'providers.mjs')));
 const C=globalThis.LimitsCore;
 const browser=await chromium.launch({executablePath:process.env.METER_CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try{
  const context=await browser.newContext();let mismatch=false,delayed=false,loadedIndex=null;
  const html=(email,bars=false)=>`<!doctype html><html><head><script>window.WIZ_global_data={"oPEP7c":${JSON.stringify(email)}};</script></head><body>${bars?'<div class="usage-metrics-container"><span class="tier-pill">Google AI Pro</span><div data-test-id="gxu-currently"><div role="progressbar" id="current" '+(delayed?'':'aria-valuenow="24"')+'></div><span>Resets tomorrow</span></div><div data-test-id="gxu-weekly"><div role="progressbar" aria-valuenow="0"></div></div></div>':''}</body></html>`;
  await context.route('https://gemini.google.com/**',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname.includes('executeQuery'))return route.fulfill({status:404,body:'not found'});
   const bars=u.pathname.endsWith('/usage');if(bars)loadedIndex=u.pathname.match(/^\/u\/(\d+)/)?.[1]||'0';
   return route.fulfill({contentType:'text/html',body:html(mismatch&&bars?'other@example.test':'active@example.test',bars)});
  });
  const gemini=await context.newPage();await gemini.goto('https://gemini.google.com/u/1/app');
  let scope=await gemini.evaluate(C.readPageContext);assert.equal(scope.accountIndex,1);
  const data=await loadGemini(scope,async spec=>{
   const r=await gemini.evaluate(requestInTab,spec);if(!r.ok){const e=new Error(r.error);e.stage=spec.kind==='bootstrap'?'Gemini bootstrap':'Gemini GraphQL';e.detail=r.detail;throw e;}return r.data;
  },Date.now,async()=>{const r=await gemini.evaluate(scrapeGeminiPage,scope);if(!r.ok)throw new Error(r.error);return r.data;},{providerState:{geminiQuery:{signature:'old-test-signature',scoped:true}}});
  assert.equal(data.usage.source,'Gemini Usage page');assert.equal(data.usage.windows[0].used,24);assert.equal(data.usage.windows[1].used,0);assert.equal(data.diagnostics.attempts[0].detail,'HTTP 404');assert.equal(loadedIndex,'1');assert.equal(await gemini.locator('iframe').count(),0);
  delayed=true;let finished=false;
  const pending=gemini.evaluate(scrapeGeminiPage,scope).then(r=>{finished=true;return r;});await wait(750);assert.equal(finished,false);
  const usageFrame=gemini.frames().find(f=>f.url().includes('/usage'));assert(usageFrame);await usageFrame.locator('#current').evaluate(n=>n.setAttribute('aria-valuenow','33'));
  assert.equal((await pending).data.windows[0].used,33);assert.equal(await gemini.locator('iframe').count(),0);
  delayed=false;mismatch=true;const bad=await gemini.evaluate(scrapeGeminiPage,scope);assert.equal(bad.error,'context');assert.equal(await gemini.locator('iframe').count(),0);
  console.log('PASS: real HTTP 404 falls back to native Gemini bars, account /u/1, explicit zero, delayed DOM without false zero, mismatch rejection and iframe cleanup.');
  // Claude observes synthetic native requests; the extension itself sends none.
  await context.route('https://claude.ai/**',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  const claude=await context.newPage();await claude.goto('https://claude.ai/new');
  await claude.evaluate(()=>{
   document.cookie='lastActiveOrg=chat-org-001; path=/';
   window.__sourceCalls=[];
   window.fetch=async function(url){
    __sourceCalls.push(String(url));
    if(String(url).includes('StreamTimeline'))return new Response(new Uint8Array(window.__timeline),{headers:{'content-type':'application/connect+proto','connect-content-encoding':window.__codec||'gzip'}});
    if(String(url).endsWith('retry_completion'))return Response.json({error:{message:JSON.stringify({windows:{'5h':{utilization:1,resets_at:Math.floor(Date.now()/1000)+3600}}})}},{status:429});
    const secret='SYNTHETIC-MESSAGE-MUST-NOT-ENTER-USAGE';
    return new Response('event: content_block_delta\ndata: '+JSON.stringify({type:'content_block_delta',text:secret})+'\n\nevent: message_limit\ndata: '+JSON.stringify({type:'message_limit',message_limit:{windows:{'5h':{utilization:.4,resets_at:Math.floor(Date.now()/1000)+3600},'7d':{utilization:0,resets_at:Math.floor(Date.now()/1000)+86400}}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
   };
  });
  await claude.addScriptTag({path:path.join(extension,'claude-bridge.js')});
  await claude.evaluate(()=>__usageMeterClaudeBridge.configure({scope:'session-one',org:'chat-org-001'}));
  const body=await claude.evaluate(async()=>await (await fetch('/api/organizations/chat-org-001/chat_conversations/conv/completion',{method:'POST'})).text());
  assert(body.includes('SYNTHETIC-MESSAGE'));await wait(50);
  let reading=await claude.evaluate(()=>__usageMeterClaudeBridge.read('session-one','chat-org-001'));assert.equal(reading.windows[0].used,40);assert.equal(reading.windows[1].used,0);assert(!JSON.stringify(reading).includes('SYNTHETIC-MESSAGE'));assert.equal(await claude.evaluate(()=>__sourceCalls.length),1);
  await claude.evaluate(()=>__usageMeterClaudeBridge.configure({scope:'session-two',org:'chat-org-001'}));assert.equal(await claude.evaluate(()=>__usageMeterClaudeBridge.read('session-two','chat-org-001')),null);
  await claude.evaluate(async()=>await fetch('/api/organizations/chat-org-001/chat_conversations/conv/retry_completion',{method:'POST'}));await wait(50);assert.equal((await claude.evaluate(()=>__usageMeterClaudeBridge.read('session-two','chat-org-001'))).windows[0].used,100);
  for(const compressed of [false,true]){
   const bytes=timelineFrame(.63,Math.floor(Date.now()/1000)+3600,compressed);await claude.evaluate(v=>window.__timeline=v,bytes);
   await claude.evaluate(async()=>await (await fetch('/api/organizations/chat-org-001/claude.chat.v1.ConversationService/StreamTimeline',{method:'POST'})).arrayBuffer());await wait(100);
   reading=await claude.evaluate(()=>__usageMeterClaudeBridge.read('session-two','chat-org-001'));assert.equal(reading.windows[0].used,63);assert.equal(reading.source,'Claude timeline event');
  }
  const deflate=timelineFrame(.71,Math.floor(Date.now()/1000)+3600,'deflate');await claude.evaluate(v=>{window.__timeline=v;window.__codec='deflate';},deflate);
  await claude.evaluate(async()=>await (await fetch('/api/organizations/chat-org-001/claude.chat.v1.ConversationService/StreamTimeline',{method:'POST'})).arrayBuffer());await wait(100);
  assert.equal((await claude.evaluate(()=>__usageMeterClaudeBridge.read('session-two','chat-org-001'))).windows[0].used,71);
  await claude.evaluate(()=>{window.__realNow=Date.now;window.__testNow=Date.now()+8*60000;Date.now=()=>window.__testNow;window.postMessage({usageMeter:'claude-observer-alive'},location.origin);});await wait(50);
  await claude.evaluate(async()=>await (await fetch('/api/organizations/chat-org-001/chat_conversations/conv/completion',{method:'POST'})).text());await wait(50);
  reading=await claude.evaluate(()=>__usageMeterClaudeBridge.read('session-two','chat-org-001'));assert.equal(reading.windows[0].used,40);assert.equal(reading.fetchedAt,await claude.evaluate(()=>window.__testNow));
  await claude.evaluate(()=>Date.now=window.__realNow);
  assert.equal(await claude.evaluate(()=>__usageMeterClaudeBridge.read('session-one','chat-org-001')),null);
  assert.equal(await claude.evaluate(()=>__usageMeterClaudeBridge.read('session-two','other-org-002')),null);
  console.log('PASS: Claude SSE fractions/zero, unchanged original response, no extra model calls, no message text in output, session reset, refusal usage and plain/gzip Connect timeline.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

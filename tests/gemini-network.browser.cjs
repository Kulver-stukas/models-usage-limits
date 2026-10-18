/* Browser regression: an initial Usage RPC finishes before any metric DOM
 * exists. No real account or provider endpoint is used. */
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.METER_PLAYWRIGHT_MODULE||'playwright');
const extension=path.resolve(__dirname,'../extension');
(async()=>{
 const {scrapeGeminiPage}=await import(pathToFileURL(path.join(extension,'gemini-dom.mjs')));
 const {loadGemini,requestInTab}=await import(pathToFileURL(path.join(extension,'providers.mjs')));
 const C=globalThis.LimitsCore;
 const browser=await chromium.launch({executablePath:process.env.METER_CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try{
  const context=await browser.newContext();
  await context.addInitScript({path:path.join(extension,'gemini-bridge.js')});
  let signature='current-live-signature',transport='fetch',mismatch=false,missing=false,frames=0,rpcs=0;
  const payload=()=>({data:{viewer:{newWrapper:{getUsageInfo:{subscriptionTier:'TIER2',pools:[
   {poolType:'GXU_FIVE_HOURLY',percentageUsed:0,gxu:{windowRefreshesAt:new Date(Date.now()+3600000).toISOString()}},
   {poolType:'GXU_WEEKLY',percentageUsed:.09,gxu:{windowRefreshesAt:new Date(Date.now()+86400000).toISOString()}}
  ]}}}},unrelated:{privateText:'MUST_NOT_ENTER_NORMALIZED_CAPTURE'}});
  await context.route('https://gemini.google.com/**',async route=>{
   const u=new URL(route.request().url()),account=u.pathname.match(/^\/u\/(\d+)/)?.[1]||'0';
   if(u.pathname.includes('executeQuery')){rpcs++;return route.fulfill(u.searchParams.get('query_signature')===signature?{contentType:'application/json',body:")]}'\n"+JSON.stringify(payload())}:{status:404,body:'stale signature'});}
   const usage=u.pathname.endsWith('/usage');if(usage)frames++;
   const query=new URLSearchParams({query_signature:signature,authuser:account,variables:JSON.stringify({g1Request:{entrypoints:['GEMINI_USAGE_SETTINGS_UPGRADE_BANNER']},workspaceRequest:{recommendationsForSurfaceRequests:[]}})});
   const rpc=`/u/${account}/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery?${query}`;
   const email=mismatch&&usage?'other@example.test':'active@example.test';
   // This request runs in the initial head script, before load and before bars.
   let script=transport==='fetch'?`fetch(${JSON.stringify(rpc)}).then(r=>r.text()).then(t=>window.nativeBody=t);`:`const x=new XMLHttpRequest();x.open('GET',${JSON.stringify(rpc)});x.onload=()=>window.nativeBody=x.responseText;x.send();`;
   if(!usage)script='';
   return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><script>${missing&&usage?'':`window.WIZ_global_data={"oPEP7c":${JSON.stringify(email)}};`}${script}</script></head><body><p>Loading, no metric bars</p></body></html>`});
  });
  const page=await context.newPage();await page.goto('https://gemini.google.com/u/1/app');
  const scope=await page.evaluate(C.readPageContext);
  const request=async spec=>{const r=await page.evaluate(requestInTab,spec);if(!r.ok){const e=Error(r.error);e.detail=r.detail;throw e;}return r.data;};
  const probe=async(options={})=>{const r=await page.evaluate(scrapeGeminiPage,{...scope,fresh:options.fresh});if(!r.ok){const e=Error(r.error);e.detail=r.detail;throw e;}return r.data;};
  const first=await loadGemini(scope,request,Date.now,probe);
  assert.equal(first.usage.source,'Gemini captured GraphQL');assert.deepEqual(first.usage.windows.map(w=>w.used),[0,9]);assert(first.usage.windows.every(w=>w.resetAt>Date.now()));assert.equal(first.plan,'ultra');
  assert.equal(first.providerState.geminiQuery.signature,signature);assert.equal(frames,1);assert.equal(rpcs,1);assert.equal(await page.locator('iframe').count(),0);
  assert(!JSON.stringify(first).includes('MUST_NOT_ENTER'));assert(!JSON.stringify(first).includes('@'));assert(!JSON.stringify(first.providerState).includes('authuser'));
  const second=await loadGemini(scope,request,Date.now,async()=>{throw Error('unnecessary iframe');},{providerState:structuredClone(first.providerState)});
  assert.equal(second.usage.source,'Gemini GraphQL');assert.equal(frames,1);assert.equal(rpcs,2);
  signature='rotated-live-signature';
  const third=await loadGemini(scope,request,Date.now,probe,{providerState:structuredClone(second.providerState)});
  assert.equal(third.usage.source,'Gemini captured GraphQL');assert.equal(third.providerState.geminiQuery.signature,signature);assert.equal(frames,2);assert.equal(rpcs,4);
  transport='xhr';const xhr=await probe({fresh:true});assert.equal(xhr.query.signature,signature);assert.equal(xhr.graphql.pools[1].percentageUsed,.09);assert.equal(await page.locator('iframe').count(),0);
  mismatch=true;await assert.rejects(()=>probe({fresh:true}),/context/);assert.equal(await page.locator('iframe').count(),0);mismatch=false;
  // Missing bootstrap identity waits for verification; it is not a mismatch
  // and does not weaken the identity boundary just because percentages exist.
  missing=true;await page.evaluate(()=>{const original=setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===40000?1200:ms,...args);});
  await assert.rejects(()=>probe({fresh:true}),/format/);assert.equal(await page.locator('iframe').count(),0);missing=false;
  const native=await context.newPage();await native.goto('https://gemini.google.com/u/1/usage');await native.waitForFunction(()=>window.nativeBody);
  const nativeScope=await native.evaluate(C.readPageContext);
  const read=await native.evaluate(h=>__usageMeterGeminiBridge.read(h),nativeScope.hint);assert(read);assert((await native.evaluate(()=>nativeBody)).includes('MUST_NOT_ENTER'));assert(!JSON.stringify(read).includes('MUST_NOT_ENTER'));
  assert.equal(await native.evaluate(()=>__usageMeterGeminiBridge.read('wrong-account')),null);
  const count=frames;const reuse=await native.evaluate(scrapeGeminiPage,nativeScope);assert.equal(reuse.data.graphql.pools[0].percentageUsed,0);assert.equal(frames,count);
  // Wrong routing and unrelated RPCs must not overwrite the last valid record.
  await native.evaluate(async()=>{await fetch('/u/2/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery?query_signature=wrong-account&authuser=2');});
  assert.equal((await native.evaluate(h=>__usageMeterGeminiBridge.read(h),nativeScope.hint)).query.signature,signature);
  await native.evaluate(()=>__usageMeterGeminiBridge.dispose());assert.equal(await native.evaluate(h=>__usageMeterGeminiBridge.read(h),nativeScope.hint),null);
  await native.addScriptTag({path:path.join(extension,'gemini-bridge.js')});assert.equal(await native.evaluate(()=>__usageMeterGeminiBridge.touch()),true);
  console.log('PASS: early fetch/XHR capture without bars; unchanged native response; verified /u/1; direct replay; rotated signature recovery; missing/mismatched identity; filtered payload; wrong account rejection; cleanup and reinstall.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

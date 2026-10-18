/* A cold /app document obtains JSON without a Usage navigation, iframe,
 * rendered bars or prior network capture. CDN JavaScript is read, never run. */
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.METER_PLAYWRIGHT_MODULE||'playwright');
const extension=path.resolve(__dirname,'../extension');
(async()=>{
 const {loadGemini,requestInTab}=await import(pathToFileURL(path.join(extension,'providers.mjs')));
 const C=globalThis.LimitsCore;
 const browser=await chromium.launch({executablePath:process.env.METER_CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try{
  const context=await browser.newContext();
  let sig='2/browser-current-public-signature=',inlineMap=true,blocked=false,usageMetadata=0,usageNavigation=0,assets=0,queries=0,wrongBootstrap=false;
  const url='https://www.gstatic.com/bg3/boq-bard-web/islands/assets/UsagePageSurface-current.js';
  const importmap='<script type="importmap">'+JSON.stringify({imports:{'@messages/assets/UsagePageSurface-current.js':'https://www.gstatic.com/bg3/boq-bard-web/islands/assets/en/UsagePageSurface-messages-current.js'}})+'</script>';
  const identity=email=>'<script>window.WIZ_global_data={"oPEP7c":'+JSON.stringify(email)+'};</script>';
  await context.route('https://www.gstatic.com/**',route=>{
   assets++;assert.equal(route.request().url(),url);assert(!route.request().headers().cookie);
   if(blocked)return route.abort('failed');
   return route.fulfill({contentType:'application/javascript',headers:{'Access-Control-Allow-Origin':'https://gemini.google.com'},body:`window.REMOTE_CODE_WAS_EXECUTED=true;throw Error('not executable');let q={params:{cacheID:\`c\`,id:\`${sig}\`,metadata:{},name:\`UsagePageQuery\`,operationKind:\`query\`,text:null}};`});
  });
  await context.route('https://gemini.google.com/**',route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.pathname.endsWith('/usage')){usageMetadata++;if(req.isNavigationRequest())usageNavigation++;assert(!req.headers().cookie);return route.fulfill({contentType:'text/html',body:'<html><head>'+importmap+'</head><body>Public shell, no quotas</body></html>'});}
   if(u.pathname.includes('executeQuery')){
    queries++;assert.equal(u.pathname,'/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery');assert.equal(u.searchParams.get('authuser'),'1');
    if(u.searchParams.get('query_signature')!==sig)return route.fulfill({status:400,body:'unknown query'});
    return route.fulfill({contentType:'application/json',body:JSON.stringify([{data:{viewer:{rpcs:{getUsageInfo:{subscriptionTier:'TIER1',pools:[{poolType:'GXU_FIVE_HOURLY',percentageUsed:.38,gxu:{windowRefreshesAt:new Date(Date.now()+3600000).toISOString()}},{poolType:'GXU_WEEKLY',percentageUsed:0,gxu:{windowRefreshesAt:new Date(Date.now()+86400000).toISOString()}}]}}}}}])});
   }
   return route.fulfill({contentType:'text/html',body:'<html><head>'+identity(wrongBootstrap?'other@example.test':'active@example.test')+(inlineMap?importmap:'')+'</head><body>App without usage bars</body></html>'});
  });
  const page=await context.newPage();await page.goto('https://gemini.google.com/u/1/app');
  const scope=await page.evaluate(C.readPageContext);
  await context.addCookies([{name:'private_session',value:'MUST_NOT_REACH_CDN_OR_PUBLIC_METADATA',domain:'.gemini.google.com',path:'/'}]);
  async function install(){await page.addScriptTag({path:path.join(extension,'shared.js')});await page.addScriptTag({path:path.join(extension,'gemini-discovery.js')});}
  await install();
  const discover=async()=>{const r=await page.evaluate(c=>GeminiDiscovery.discover(c),scope);if(!r.ok){const e=Error(r.error);e.diagnostics={attempts:r.attempts};throw e;}return r.data;};
  const request=async spec=>{const r=await page.evaluate(requestInTab,spec);if(!r.ok)throw Error(r.error);return r.data;};
  const noDOM=async()=>{throw Error('A native Usage probe must not be used');};
  const first=await loadGemini(scope,request,Date.now,noDOM,{discover});
  assert.deepEqual(first.usage.windows.map(w=>w.used),[38,0]);assert.equal(first.usage.source,'Gemini GraphQL');assert.equal(queries,1);assert.equal(assets,1);assert.equal(usageMetadata,0);assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.evaluate(()=>window.REMOTE_CODE_WAS_EXECUTED),undefined);
  sig='2/browser-rotated-public-signature=';
  const next=await loadGemini(scope,request,Date.now,noDOM,{discover,providerState:first.providerState});assert.equal(next.providerState.geminiQuery.signature,sig);assert.equal(queries,3);assert.equal(usageMetadata,0);
  inlineMap=false;await page.goto('https://gemini.google.com/u/1/app');await install();
  const fallback=await loadGemini(scope,request,Date.now,noDOM,{discover});assert.equal(fallback.usage.source,'Gemini GraphQL');assert.equal(usageMetadata,1);assert.equal(usageNavigation,0);assert.equal(await page.locator('iframe').count(),0);
  assert(!JSON.stringify(fallback).includes('private_session'));assert(!JSON.stringify(fallback).includes('@'));assert(!JSON.stringify(fallback).includes('REMOTE_CODE_WAS_EXECUTED'));
  blocked=true;const rejected=await page.evaluate(c=>GeminiDiscovery.discover(c),scope);assert.equal(rejected.ok,false);assert(rejected.attempts.some(a=>a.detail?.includes('blocked')));blocked=false;
  wrongBootstrap=true;await assert.rejects(()=>loadGemini(scope,request,Date.now,noDOM,{discover,providerState:fallback.providerState}),/context/);
  console.log('PASS: cold /app → current import-map descriptor → direct JSON; signature rotation; anonymous shell metadata fallback; no Usage navigation/iframe/bars; no remote execution or cookie forwarding; asset network failure and account-switch rejection.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

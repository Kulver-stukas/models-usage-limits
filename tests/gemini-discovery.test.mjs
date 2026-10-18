import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/gemini-discovery.js';
import {loadGemini,geminiPaths,tabRequest} from '../extension/providers.mjs';
import {requestGeminiJSON,geminiResponseContext} from '../extension/gemini-http.mjs';
const D=globalThis.GeminiDiscovery,now=1800000000000;
const signature='2/current-public-query-signature=';
const source=sig=>`throw Error('THIS CODE MUST NOT RUN');const q={params:{cacheID:\`cache\`,id:\`${sig}\`,metadata:{},name:\`UsagePageQuery\`,operationKind:\`query\`,text:null}};`;
const raw=()=>[{data:{viewer:{rpcs:{getUsageInfo:{pools:[{poolType:'GXU_FIVE_HOURLY',percentageUsed:.24,gxu:{windowRefreshesAt:'2027-01-15T10:00:00Z'}}]}}}}}];
test('Relay descriptor uses exact params name and id, supports template quotes and never evaluates code',()=>{
 assert(!source(signature).includes('query_signature'));assert.equal(D.descriptor(source(signature)).signature,signature);assert.equal(D.descriptor(source(signature)).scoped,false);
 assert.throws(()=>D.descriptor(source(signature).replace('UsagePageQuery','OtherQuery')),/format/);
 assert.throws(()=>D.descriptor(source(signature)+source('2/another-public-query-signature=')),/format/);
 assert.equal(D.descriptor(source(signature)+source(signature)).signature,signature);
 assert.throws(()=>D.descriptor('getUsageInfo query_signature="unrelated-signature"'),/format/);
});
test('current import-map shape resolves only public UsagePageSurface code assets',()=>{
 const html='<script type="importmap">'+JSON.stringify({imports:{'@messages/assets/UsagePageSurface-CJLuUqL2.js':'https://www.gstatic.com/bg3/boq-bard-web/islands/assets/en/UsagePageSurface-messages-DtY-kX7r.js'}})+'</script>';
 assert.deepEqual(D.assets(D.metadata(html)),['https://www.gstatic.com/bg3/boq-bard-web/islands/assets/UsagePageSurface-CJLuUqL2.js']);
 for(const host of ['evil.test','www.gstatic.com.evil.test'])assert.deepEqual(D.assets(D.metadata(html.replace('www.gstatic.com',host))),[]);
 assert.deepEqual(D.assets({urls:['https://www.gstatic.com/private.js','https://www.gstatic.com/bg3/boq-bard-web/islands/assets/UsagePageSurface-code.js?secret=x']}),[]);
});
test('cold Gemini start discovers public descriptor and reads JSON without any native page probe',async()=>{
 const calls=[];let discovered=0;
 const r=await loadGemini({hint:'account',accountIndex:1},async spec=>{calls.push(spec);return spec.kind==='bootstrap'?'account':raw();},()=>now,async()=>{throw Error('No iframe should be used');},{discover:async()=>{discovered++;return D.descriptor(source(signature));}});
 assert.equal(discovered,1);assert.equal(calls.length,3);assert.equal(r.usage.source,'Gemini GraphQL');assert.equal(r.usage.windows[0].used,24);assert.match(calls[1].path,/^\/_\/BardChatUi/);assert.equal(new URL(calls[1].path,'https://gemini.google.com').searchParams.get('authuser'),'1');assert.equal(r.providerState.geminiQuery.signature,signature);
 assert(!JSON.stringify(r).includes('THIS CODE MUST NOT RUN'));
});
test('rejected cached descriptor is refreshed from public code and JSON retried before iframe',async()=>{
 let discoveries=0,queries=0;
 const r=await loadGemini({hint:'account',accountIndex:1},async spec=>{if(spec.kind==='bootstrap')return 'account';queries++;if(!spec.path.includes(encodeURIComponent(signature)))throw Error('format');return raw();},()=>now,async()=>{throw Error('unexpected iframe');},{providerState:{geminiQuery:{signature:'obsolete-signature',scoped:true}},discover:async()=>{discoveries++;return D.descriptor(source(signature));}});
 assert.equal(queries,2);assert.equal(discoveries,1);assert.equal(r.usage.source,'Gemini GraphQL');
});
test('descriptor failures respect persisted discovery cooldown and manual retry',async()=>{
 let discoveries=0;const discover=async()=>{discoveries++;throw Error('network');};
 const dom=async()=>({windows:[{id:'five',seconds:18000,used:0,main:true}],plan:null});
 const first=await loadGemini({hint:'account',accountIndex:0},async()=>{throw Error('No JSON before descriptor');},()=>now,dom,{discover});
 assert.equal(discoveries,1);assert(first.providerState.discoveryRetryAt>now);
 const second=await loadGemini({hint:'account'},async()=>{},()=>now+300000,dom,{discover,providerState:first.providerState,previousUsage:first.usage});
 assert.equal(second.deferred,true);assert.equal(discoveries,1);
 await loadGemini({hint:'account'},async()=>{},()=>now+300000,dom,{discover,providerState:first.providerState,previousUsage:first.usage,force:true});assert.equal(discoveries,2);
});
test('worker fallback permits only account-routed Gemini usage GET and keeps cookies inside fetch',async()=>{
 let requests=0;
 const spec={provider:'gemini',accountIndex:1,path:geminiPaths(1,{signature,scoped:false}).usage};
 const fetcher=async(url,options)=>{requests++;assert.equal(options.credentials,'include');assert.equal(options.redirect,'follow');assert(!options.headers.Cookie);return {ok:true,text:async()=>JSON.stringify(raw())};};
 assert.equal((await requestGeminiJSON(spec,fetcher)).ok,true);assert.equal(requests,1);
 for(const bad of [{...spec,path:'https://evil.test/'},{...spec,accountIndex:2},{...spec,path:spec.path.replace('/_/','/u/2/_/')},{...spec,provider:'claude'}])assert.equal((await requestGeminiJSON(bad,fetcher)).error,'context');
 assert.equal(requests,1);assert.equal((await requestGeminiJSON(spec,async()=>({ok:true,text:async()=>'<html>Sign in</html>'}))).error,'auth');
});
test('real Google canonical redirect may remove authuser=0 but must preserve a nonzero account',()=>{
 const root='https://gemini.google.com',zero=root+geminiPaths(0,{signature,scoped:false}).usage;
 const canonical=new URL(zero);canonical.searchParams.delete('authuser');
 assert.equal(geminiResponseContext(zero,canonical.href,0),null);
 const one=root+geminiPaths(1,{signature,scoped:false}).usage;
 assert.equal(geminiResponseContext(one,canonical.href,1),'context');
 canonical.pathname='/u/1'+canonical.pathname;assert.equal(geminiResponseContext(one,canonical.href,1),null);
 canonical.searchParams.set('authuser','2');assert.equal(geminiResponseContext(one,canonical.href,1),'context');
 assert.equal(geminiResponseContext(one,'https://accounts.google.com/',1),'auth');
});
test('tab network error uses extension fallback; 429 is not retried through another transport',async()=>{
 const priorChrome=globalThis.chrome,priorFetch=globalThis.fetch;let pageError='network',requests=0;
 try{
  globalThis.chrome={scripting:{executeScript:async()=>[{frameId:0,result:{ok:false,error:pageError,detail:'TypeError'}}]}};
  globalThis.fetch=async()=>{requests++;return {ok:true,text:async()=>JSON.stringify(raw())};};
  const spec={provider:'gemini',accountIndex:1,path:geminiPaths(1,{signature,scoped:false}).usage};
  assert.equal(typeof await tabRequest(1,spec),'string');assert.equal(requests,1);
  pageError='rate';await assert.rejects(()=>tabRequest(1,spec),/rate/);assert.equal(requests,1);
 }finally{globalThis.chrome=priorChrome;globalThis.fetch=priorFetch;}
});

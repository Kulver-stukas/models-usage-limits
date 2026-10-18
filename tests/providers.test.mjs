import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import '../extension/shared.js';
import {loadClaude,loadGemini,geminiPaths,requestInTab} from '../extension/providers.mjs';
import {fingerprint} from '../extension/api.mjs';
const C=globalThis.LimitsCore,now=1800000000000;
const captured={signature:'live-test-signature',scoped:true};
const seeded={providerState:{geminiQuery:captured}};
const claude={five_hour:{utilization:24,resets_at:'2027-01-15T10:00:00Z'},seven_day:{utilization:0,resets_at:null},seven_day_sonnet:{utilization:12,resets_at:null},extra_usage:{is_enabled:false,utilization:30}};
const gemini=()=>[{data:{viewer:{rpcs:{getUsageInfo:{subscriptionTier:'TIER1',pools:[{poolType:'GXU_FIVE_HOURLY',percentageUsed:.24,gxu:{windowRefreshesAt:'2027-01-15T10:00:00Z'}},{poolType:'GXU_WEEKLY',percentageUsed:0,gxu:{windowRefreshesAt:null}}]}}}},errors:[{message:'Unrelated banner error'}]}];
test('Claude: main, model windows, zero and optional extra usage are distinguished',()=>{
  const u=C.parseClaude(claude,now);assert.equal(u.windows.length,3);assert.equal(u.windows[0].used,24);assert.equal(u.windows[1].used,0);assert.equal(u.windows[2].main,false);assert.equal(u.windows[1].resetAt,null);
  assert.equal(C.parseClaude({...claude,extra_usage:{is_enabled:true,utilization:30}},now).windows.length,4);
  assert.throws(()=>C.parseClaude({},now),/format/);assert.equal(C.parseClaude({five_hour:{utilization:null}},now).windows.length,0);
  assert.equal(C.parseClaude({five_hour:null,seven_day:null},now).windows.length,0);
});
test('Gemini: XSSI, fractions, partial GraphQL errors, zero and unknown pools',()=>{
  const u=C.parseGemini(")]}'\n"+JSON.stringify(gemini()),now);assert.equal(u.windows[0].used,24);assert.equal(u.windows[1].used,0);assert.equal(u.plan,'pro');assert.equal(u.windows[1].resetAt,null);
  const empty=gemini();empty[0].data.viewer.rpcs.getUsageInfo.pools=[];assert.equal(C.parseGemini(empty,now).windows.length,0);
  assert.throws(()=>C.parseGemini([{data:{viewer:null}}],now),/auth/);assert.throws(()=>C.parseGemini('{}',now),/format/);
  const bad=gemini();bad[0].data.viewer.rpcs.getUsageInfo.pools[0].percentageUsed='0';assert.throws(()=>C.parseGemini(bad,now),/format/);
});
test('URL routing rejects shared pages, APIs and lookalike hosts',()=>{
  for(const [url,p] of [['https://chatgpt.com/c/a','chatgpt'],['https://claude.ai/chat/a','claude'],['https://gemini.google.com/u/1/app/a','gemini'],['https://example.com',null],['https://claude.ai.evil.test',null],['https://chatgpt.com/share/a',null],['https://claude.ai/api/organizations',null],['https://gemini.google.com/_/a',null],['chrome://extensions',null]])assert.equal(C.providerForURL(url),p);
});
test('Claude org selection uses active org, never the first API org or an ambiguous chat org',async()=>{
  const orgs=[{uuid:'api-org-000',capabilities:['api']},{uuid:'chat-org-001',capabilities:['chat','claude_pro']},{uuid:'chat-org-002',capabilities:['chat','claude_max']}];
  const paths=[],request=async s=>{paths.push(s.path);return s.path==='/api/organizations'?orgs:claude;};
  const result=await loadClaude({org:'chat-org-002'},request,async()=>'hashed-session',()=>now);
  assert.equal(paths[1],'/api/organizations/chat-org-002/usage');assert.equal(result.plan,'max');
  assert(!JSON.stringify(result).includes('chat-org-002'));assert(!JSON.stringify(result).includes('hashed-session'));
  await assert.rejects(()=>loadClaude({},request,async()=>'s'),/context/);
  await assert.rejects(()=>loadClaude({org:'api-org-000'},request,async()=>'s'),/context/);
});
test('Claude session changes and different seats do not reuse an account key',async()=>{
  const request=async s=>s.path==='/api/organizations'?[{uuid:'chat-org-001',capabilities:['chat']}]:claude;
  let n=0;await assert.rejects(()=>loadClaude({org:'chat-org-001'},request,async()=>++n===1?'a':'b'),/context/);
  const a=await loadClaude({},request,async()=>'seat-a'),b=await loadClaude({},request,async()=>'seat-b');assert.notEqual(a.key,b.key);
});
test('Gemini selects Google account explicitly and verifies bootstrap identity twice',async()=>{
  const context={accountIndex:1,hint:'identity-hash'},calls=[];
  const result=await loadGemini(context,async spec=>{calls.push(spec);return spec.kind==='bootstrap'?'identity-hash':gemini();},()=>now,null,seeded);
  assert.equal(calls.length,3);assert.match(calls[1].path,/^\/u\/1\/_\/BardChatUi\/graphql/);assert.equal(new URL(calls[1].path,'https://gemini.google.com').searchParams.get('authuser'),'1');assert.equal(result.usage.windows[0].used,24);
  let n=0;await assert.rejects(()=>loadGemini(context,async s=>s.kind==='bootstrap'?(++n===1?'identity-hash':'new-account'):gemini(),()=>now,null,seeded),/context/);
  await assert.rejects(()=>loadGemini(context,async()=>'wrong-account',()=>now,null,seeded),/context/);
  assert(!geminiPaths(0,captured).usage.startsWith('/u/'));
});
test('page bootstrap fingerprints account identity, ignores other emails, does not expose email',async()=>{
  async function scope(index,email){
    const context=vm.createContext({location:{hostname:'gemini.google.com',href:`https://gemini.google.com/u/${index}/app`},document:{cookie:'',scripts:[{textContent:`window.WIZ_global_data={"other":"other@example.com","oPEP7c":${JSON.stringify(email)}};`}]},crypto,URL,TextEncoder});
    return vm.runInContext('('+C.readPageContext.toString()+')()',context);
  }
  const a=await scope(0,'a@example.com'),b=await scope(1,'b@example.com');assert.notEqual(a.scope,b.scope);assert(!JSON.stringify(a).includes('@'));assert.equal(a.hint,await fingerprint('gemini/0/a@example.com'));
});
test('tab bridge limits origin/path and never treats auth HTML as zero usage',async()=>{
  const run=async(spec,response)=>{
    const ctx=vm.createContext({location:{hostname:'gemini.google.com',origin:'https://gemini.google.com'},URL,AbortSignal,crypto,TextEncoder,fetch:async()=>response});
    return vm.runInContext('('+requestInTab.toString()+')('+JSON.stringify(spec)+')',ctx);
  };
  const base={provider:'gemini',path:geminiPaths(0,captured).usage};
  assert.equal((await run({...base,path:'https://evil.test/app'})).error,'context');
  assert.equal((await run(base,{ok:true,text:async()=>'<html>Login</html>'})).error,'auth');
  assert.equal((await run(base,{ok:false,status:429})).error,'rate');
});
test('Claude limits[] overrides matching legacy windows and null is not zero',()=>{
 const u=C.parseClaude({five_hour:null,seven_day:null,limits:[{kind:'session',percent:31,resets_at:'2027-01-15T10:00:00Z'},{kind:'weekly_all',percent:0,resets_at:null},{kind:'weekly_scoped',percent:17.2,scope:{model:{display_name:'Fable'}}},{kind:'unknown',percent:99}]},now);
 assert.deepEqual(u.windows.map(w=>w.used),[31,0,17.2]);assert.equal(u.windows[0].main,true);assert.equal(u.windows[2].main,false);
 assert.equal(C.parseClaude({five_hour:null,seven_day:null},now).windows.length,0);assert.match(C.parseClaude({five_hour:null,seven_day:null},now).unavailable,/no numeric usage/);
});
test('Gemini JSON failures use verified native-page data and retain stage diagnostics',async()=>{
 const e=new Error('network');e.stage='Gemini GraphQL';e.detail='HTTP 404';
 const result=await loadGemini({hint:'account',accountIndex:0},async()=>{throw e;},()=>now,async()=>({windows:[{id:'five',used:24,main:true}],plan:'pro'}),seeded);
 assert.equal(result.usage.source,'Gemini Usage page');assert.equal(result.usage.windows[0].used,24);assert.equal(result.diagnostics.attempts[0].detail,'HTTP 404');
 for(const code of ['context','rate']){let fallback=false;await assert.rejects(()=>loadGemini({hint:'account'},async()=>{throw new Error(code);},()=>now,async()=>{fallback=true;},seeded),new RegExp(code));assert.equal(fallback,false);}
});
test('Claude empty REST can use a live reading and still rejects session switches',async()=>{
 const request=async s=>s.path==='/api/organizations'?[{uuid:'chat-org-001',capabilities:['chat']}]:{five_hour:null,seven_day:null};
 const live={windows:[{id:'five_hour',used:44,resetAt:now+100000,main:true}],fetchedAt:now};
 const result=await loadClaude({org:'chat-org-001'},request,async()=>'session',()=>now,async()=>live);
 assert.equal(result.usage.windows[0].used,44);assert.equal(result.usage.source,'Claude live event');assert.deepEqual(result.diagnostics.shape,{five_hour:'null',seven_day:'null',limits:'absent'});
 let n=0;await assert.rejects(()=>loadClaude({org:'chat-org-001'},request,async()=>++n<3?'a':'b',()=>now,async()=>live),/context/);
});
test('Gemini remembers failed JSON, throttles background DOM and allows manual refresh',async()=>{
 let time=now,json=0,dom=0;
 const request=async()=>{json++;const e=new Error('network');e.stage='Gemini GraphQL';e.detail='TypeError';throw e;};
 const read=async()=>{dom++;return {plan:'pro',windows:[{id:'main',seconds:18000,main:true,used:0,resetText:'Resets at 9:37 PM',resetAt:null}]};};
 const first=await loadGemini({hint:'account',accountIndex:0},request,()=>time,read,seeded);
 assert.equal(first.usage.windows[0].used,0);assert.equal(typeof first.usage.windows[0].resetAt,'number');assert.equal(first.usage.fetchedAt,time);
 time+=5*60000;
 const options={providerState:first.providerState,previousUsage:first.usage};
 const deferred=await loadGemini({hint:'account'},request,()=>time,read,options);assert.equal(deferred.deferred,true);assert.equal(json,1);assert.equal(dom,1);
 const manual=await loadGemini({hint:'account'},request,()=>time,read,{...options,force:true});assert.equal(manual.usage.fetchedAt,time);assert.equal(json,1);assert.equal(dom,2);
 time+=11*60000;
 await loadGemini({hint:'account'},request,()=>time,read,{providerState:manual.providerState,previousUsage:manual.usage});assert.equal(json,1);assert.equal(dom,3);
});
test('Gemini discovers a native query, replays it without a frame and replaces a rejected signature',async()=>{
 const context={hint:'account',accountIndex:1};let probes=0,requests=[];
 const graphql=gemini()[0].data.viewer.rpcs.getUsageInfo;
 const probe=async()=>({graphql,query:{signature:++probes===1?'live-first':'live-replacement',scoped:true},observedAt:now});
 const first=await loadGemini(context,async()=>{throw Error('unexpected request before discovery');},()=>now,probe);
 assert.equal(first.usage.source,'Gemini captured GraphQL');assert.equal(first.providerState.geminiQuery.signature,'live-first');assert.equal(first.providerState.jsonRetryAt,0);
 const second=await loadGemini(context,async spec=>{requests.push(spec);return spec.kind==='bootstrap'?'account':gemini();},()=>now+300000,probe,{providerState:structuredClone(first.providerState)});
 assert.equal(probes,1);assert.equal(requests.length,3);assert.match(requests[1].path,/^\/u\/1\/_\//);assert.match(requests[1].path,/query_signature=live-first/);assert.equal(second.usage.source,'Gemini GraphQL');
 const third=await loadGemini(context,async spec=>{if(spec.kind==='bootstrap')return 'account';throw Error('network');},()=>now+600000,probe,{providerState:second.providerState});
 assert.equal(probes,2);assert.equal(third.providerState.geminiQuery.signature,'live-replacement');
 const other=await loadGemini({...context,hint:'other'},async()=>{throw Error('must not reuse query across contexts');},()=>now,async()=>({graphql,query:{signature:'other-account-signature',scoped:false},observedAt:now}));
 assert.notEqual(first.key,other.key);assert.equal(other.providerState.geminiQuery.signature,'other-account-signature');
 const u=new URL(geminiPaths(2,{...captured,scoped:false}).usage,'https://gemini.google.com');assert.equal(u.pathname.startsWith('/u/'),false);assert.equal(u.searchParams.get('authuser'),'2');assert.equal(geminiPaths(0).usage,null);
});
test('Gemini parser follows named pools through wrappers and keeps one as 100 percent',()=>{
 const info=gemini()[0].data.viewer.rpcs.getUsageInfo;info.subscriptionTier='TIER2';info.pools[0].percentageUsed=1;
 const u=C.parseGemini({batch:{results:[{newWrapper:info}]}},now);assert.equal(u.windows[0].used,100);assert.equal(u.windows[1].used,0);assert.equal(u.plan,'ultra');
 info.pools[0].percentageUsed=24;assert.throws(()=>C.parseGemini({wrapped:info},now),/format/);
});

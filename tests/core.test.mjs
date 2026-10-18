import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/shared.js';
import {Engine} from '../extension/engine.mjs';
import {loadBundle} from '../extension/api.mjs';
const C=globalThis.LimitsCore;
const now=1800000000000;
const business={plan_type:'team',rate_limit:{primary_window:{used_percent:38,limit_window_seconds:18000,reset_at:1800001000},secondary_window:{used_percent:19,limit_window_seconds:604800,reset_after_seconds:1000}},
  model_usage:{'model-astra':{available:true}},rate_limit_reset_credits:{available_count:3,applicable_available_count:0}};
const init={limits_progress:[{feature_name:'deep_research',remaining:25,reset_after:'2026-11-15T18:09:19+00:00'},{feature_name:'unknown_feature',remaining:0}],model_limits:[]};
const bundle=(key='business')=>({key,label:key,plan:'team',usage:C.parseUsage(business,now),init:C.parseInit(init,now),errors:[]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('Business: percentages, absolute resets, zero applicable resets, model availability',()=>{
  const u=C.parseUsage(business,now);
  assert.equal(C.percent(u.windows[0].used,'left'),62);
  assert.equal(C.percent(u.windows[1].used,'left'),81);
  assert.equal(u.windows[0].resetAt,1800001000000);
  assert.deepEqual(u.resets,{available:3,applicable:0});
  assert.equal(u.models[0].available,true);
  assert.equal(C.color(38),C.color(100-62));
  assert.equal(C.percent(38.5,'used')+C.percent(38.5,'left'),100);
});
test('Free: a single 30-day window, no invented weekly limit; zero feature retained',()=>{
  const u=C.parseUsage({rate_limit:{primary_window:{used_percent:0,limit_window_seconds:2592000},secondary_window:null}},now);
  assert.equal(u.windows.length,1);assert.equal(u.windows[0].label,'30-day limit');
  assert.equal(C.percent(u.windows[0].used,'left'),100);
  const f=C.parseInit(init,now).features;
  assert.equal(f[1].remaining,0);assert.equal(f[1].label,'unknown feature');
});
test('weekly-only and additional windows are labeled by duration; missing is not zero',()=>{
  const u=C.parseUsage({rate_limit:{primary_window:{used_percent:20,limit_window_seconds:604800}},additional_rate_limits:[{limit_name:'Extra',rate_limit:{primary_window:{used_percent:95,limit_window_seconds:86400}}}]},now);
  assert.equal(u.windows[0].label,'Weekly limit');assert.equal(u.windows[1].main,false);
  assert.equal(C.parseUsage({rate_limit:null},now).windows.length,0);
  assert.throws(()=>C.parseUsage({},now),/format/);
  assert.throws(()=>C.parseUsage({rate_limit:{primary_window:{used_percent:'unknown'}}},now),/format/);
  assert.throws(()=>C.parseInit({},now),/format/);
  assert.match(C.countdown(now-1,now),/awaiting update/);
});
test('many tabs share a single in-flight fetch',async()=>{
  const gate=deferred();let calls=0;
  const engine=new Engine({load:()=>{calls++;return gate.promise;},save:async()=>{},now:()=>now});
  const requests=Array.from({length:20},()=>engine.refresh());gate.resolve(bundle());await Promise.all(requests);
  assert.equal(calls,1);assert.equal(engine.view().snapshot.usage.windows[0].used,38);
});
test('delayed old-context response is discarded; next context is fetched',async()=>{
  const gate=deferred();let calls=0;
  const engine=new Engine({load:()=>++calls===1?gate.promise:Promise.resolve(bundle('new')),save:async()=>{},now:()=>now});
  await engine.observeContext('a');const old=engine.refresh();
  await engine.observeContext('b');assert.equal(engine.view().snapshot,null);
  const fresh=engine.refresh(true);gate.resolve(bundle('old'));await Promise.all([old,fresh]);
  assert.equal(engine.view().snapshot.label,'new');assert.equal(engine.accounts.old,undefined);
});
test('network and partial failures preserve per-account last-good values and use backoff',async()=>{
  let time=now,n=0;
  const engine=new Engine({load:async()=>{n++;if(n===1)return bundle();if(n===2)throw new Error('network');return {...bundle(),usage:null,errors:['usage: rate']};},save:async()=>{},now:()=>time});
  await engine.refresh();time+=60000;await engine.refresh();
  assert.equal(engine.view().snapshot.usage.windows[0].used,38);assert.equal(engine.error,'network');
  await engine.refresh(true);assert.equal(n,2);time+=60001;await engine.refresh();
  assert.equal(engine.view().snapshot.usage.fetchedAt,now);
  assert.match(engine.error,/rate/);
});
test('old account cache is hidden when verification fails',async()=>{
  const engine=new Engine({load:async()=>{throw new Error('auth');},save:async()=>{},now:()=>now,initial:{accounts:{old:bundle()},selected:'old',hint:'a'}});
  await engine.observeContext('b');await engine.refresh();assert.equal(engine.view().snapshot,null);
});
test('backoff survives worker restarts',async()=>{
  let saved,time=now;
  const options={load:async()=>{throw new Error('network');},save:async state=>{saved=state;},now:()=>time};
  await new Engine(options).refresh();assert.equal(saved.failures,1);
  time+=60001;const restarted=new Engine({...options,initial:saved});await restarted.refresh();
  assert.equal(saved.failures,2);assert.equal(saved.retryAt,time+120000);
});
test('manual refresh bypasses network backoff after 15s but never rate-limit backoff',async()=>{
  for(const kind of ['network','rate']){
    let time=now,calls=0;
    const engine=new Engine({load:async()=>{calls++;if(calls===1)throw new Error(kind);return bundle();},save:async()=>{},now:()=>time});
    await engine.refresh();time+=16000;await engine.refresh(true);
    assert.equal(calls,kind==='rate'?1:2);
  }
});
test('feature backoff is isolated from healthy main usage and skips a rate-limited source',async()=>{
  let time=now,calls=0,options;
  const engine=new Engine({load:async opts=>{calls++;options=opts;return {...bundle(),init:null,initSkipped:opts.skipFeatures,errors:opts.skipFeatures?[]:['features: rate']};},save:async()=>{},now:()=>time});
  await engine.refresh();assert.equal(engine.retryAt,0);assert.equal(engine.featureRetryAt,time+60000);
  time+=16000;await engine.refresh(true);assert.equal(calls,2);assert.equal(options.skipFeatures,true);
  assert.equal(engine.view().snapshot.usage.fetchedAt,now);assert.equal(engine.view().snapshot.errors[0],'features: rate');
});
test('serialized persistence cannot restore stale data after a newer update',async()=>{
  const gate=deferred(),saved=[];let calls=0;
  const engine=new Engine({load:async()=>bundle(),save:async(s)=>{if(++calls===1)await gate.promise;saved.push(s.hint);},now:()=>now});
  const a=engine.observeContext('a');const b=engine.observeContext('b');gate.resolve();await Promise.all([a,b]);
  assert.deepEqual(saved,['a','b']);
});
function mockApi({switchAccount=false,mismatch=false,failInit=false}={}) {
  const requests=[];let sessions=0;
  const fetch=async(url,options)=>{
    requests.push({url,headers:structuredClone(options.headers || {})});let data;
    if(url.endsWith('/session')) {sessions++;data={accessToken:'SECRET-TOKEN',user:{id:'private-user'},account:{id:switchAccount&&sessions>1?'other':'private-account',structure:'workspace',planType:'team'}};}
    else if(url.endsWith('/usage'))data={...business,account_id:mismatch?'other':'private-account',user_id:'private-user',email:'private@example.com'};
    else {if(failInit)return {ok:false,status:429};data=init;}
    return {ok:true,status:200,json:async()=>data};
  };
  return {fetch,requests};
}
test('API: workspace header, session verification, normalized output contains no credentials or identity',async()=>{
  const mock=mockApi();const result=await loadBundle(mock.fetch,()=>now);
  assert.equal(mock.requests.length,4);
  assert.equal(mock.requests[1].headers['chatgpt-account-id'],'private-account');
  const output=JSON.stringify(result);for(const secret of ['SECRET-TOKEN','private-user','private-account','private@example.com'])assert(!output.includes(secret));
});
test('API: reject session switch and mismatching response account; keep valid usage on feature failure',async()=>{
  await assert.rejects(()=>loadBundle(mockApi({switchAccount:true}).fetch),/context/);
  await assert.rejects(()=>loadBundle(mockApi({mismatch:true}).fetch),/context/);
  const result=await loadBundle(mockApi({failInit:true}).fetch);assert(result.usage);assert.equal(result.init,null);assert.deepEqual(result.errors,['features: rate']);
});
test('API: skipped feature endpoint still verifies the session before and after',async()=>{
  const mock=mockApi();const result=await loadBundle(mock.fetch,()=>now,{skipFeatures:true});
  assert.equal(mock.requests.length,3);assert.equal(result.initSkipped,true);assert.equal(result.init,null);assert.deepEqual(result.errors,[]);
});
test('passive live usage is account-checked and survives a late empty REST response',async()=>{
 let time=now;const gate=deferred();let count=0;
 const engine=new Engine({load:async()=>++count===1?bundle():gate.promise,save:async()=>{},now:()=>time});await engine.refresh();
 time+=61000;const pending=engine.refresh();const live={windows:[{id:'five_hour',used:45,main:true,resetAt:time+100000}],fetchedAt:time+1,source:'Claude SSE event'};
 assert.equal(await engine.acceptUsage('other-seat',live),false);assert.equal(await engine.acceptUsage('business',live),true);
 gate.resolve({...bundle(),usage:{windows:[],fetchedAt:time+20}});await pending;assert.equal(engine.view().snapshot.usage.windows[0].used,45);
 assert.equal(engine.view().snapshot.usage.source,'Claude SSE event');
});
test('a fresh empty REST reading cannot suppress an earlier but valid passive reading',async()=>{
 const engine=new Engine({load:async()=>({...bundle(),usage:{windows:[],fetchedAt:now+100}}),save:async()=>{},now:()=>now});await engine.refresh();
 const result=await engine.acceptUsage('business',{windows:[{id:'five_hour',used:40,main:true,resetAt:now+10000}],fetchedAt:now,source:'Claude SSE event'});
 assert.equal(result,true);assert.equal(engine.view().snapshot.usage.windows[0].used,40);
});
test('native Gemini reset labels: local time, explicit date, year rollover and unknown forms',()=>{
 const at=new Date(2026,9,17,21,0).getTime();
 assert.equal(C.parseResetText('Resets at 9:37 PM',at),new Date(2026,9,17,21,37).getTime());
 assert.equal(C.parseResetText('Resets Oct 19 at 6:37 PM',at),new Date(2026,9,19,18,37).getTime());
 assert.equal(C.parseResetText('Сброс 19 окт. в 18:37',at),new Date(2026,9,19,18,37).getTime());
 assert.equal(C.parseResetText('Resets at 12:00 AM',at),new Date(2026,9,18,0,0).getTime());
 assert.equal(C.parseResetText('Resets Jan 1 at 1:30 AM',new Date(2026,11,31,21).getTime()),new Date(2027,0,1,1,30).getTime());
 assert.equal(C.parseResetText('Resets tomorrow',at),null);assert.equal(C.parseResetText('Resets Feb 31 at 1:30 PM',at),null);assert.equal(C.parseResetText('at 13:37 PM',at),null);
 const usage={fetchedAt:at,source:'Gemini Usage page',windows:[{used:9,resetAt:null,resetText:'Resets Oct 19 at 6:37 PM'}]};
 assert.equal(C.displayWindows(usage)[0].resetAt,new Date(2026,9,19,18,37).getTime());
});
test('chat-event usage remains a last report until reset, not a periodic polling result',()=>{
 const usage={source:'Claude live event',fetchedAt:now-60*60000,windows:[{used:26,resetAt:now+60000,main:true}]};
 assert.equal(C.usageHealth({snapshot:{usage}},now).muted,false);assert.equal(C.usageHealth({snapshot:{usage}},now).message,null);
 assert.equal(C.displayWindows(usage,now+60001).length,0);assert.match(C.usageHealth({snapshot:{usage}},now+60001).message,/window ended/);
 const failed={snapshot:{usage:{...usage,source:'Gemini Usage page'}},error:'format'};assert.match(C.usageHealth(failed,now).message,/Last update failed/);
});
test('transport cooldown survives persistence without refreshing old readings or clearing errors',async()=>{
 let saved,time=now;
 const engine=new Engine({load:async()=>{const e=new Error('format');e.providerState={jsonRetryAt:time+30*60000};throw e;},save:async s=>{saved=s;},now:()=>time});
 await engine.refresh();assert.equal(saved.providerState.jsonRetryAt,time+30*60000);
 time+=60001;
 const resumed=new Engine({initial:saved,load:async options=>{assert.equal(options.providerState.jsonRetryAt,now+30*60000);return {deferred:true,providerState:options.providerState};},save:async()=>{},now:()=>time});
 resumed.error='format';await resumed.refresh();assert.equal(resumed.error,'format');assert.equal(resumed.view().snapshot,null);
});
test('a successful native reading clears the prior transport error and keeps observation time',async()=>{
 let time=now,n=0;
 const load=async()=>{n++;if(n===2){const e=new Error('format');e.providerState={jsonRetryAt:time+30*60000};throw e;}return {...bundle(),usage:{...bundle().usage,source:'Gemini Usage page',fetchedAt:time},providerState:{jsonRetryAt:time+30*60000}};};
 const engine=new Engine({load,save:async()=>{},now:()=>time});await engine.refresh();time+=61000;await engine.refresh();assert.equal(engine.error,'format');assert.equal(engine.view().snapshot.usage.fetchedAt,now);
 time+=16000;await engine.refresh(true);assert.equal(engine.error,null);assert.equal(engine.view().snapshot.usage.fetchedAt,time);assert.equal(engine.confirmed,true);
});

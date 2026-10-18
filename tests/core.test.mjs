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

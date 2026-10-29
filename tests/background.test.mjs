import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {Engine} from '../extension/engine.mjs';
import {fingerprint} from '../extension/api.mjs';
import {ResetMarkers,markerKey} from '../extension/reset-markers.mjs';
import '../extension/shared.js';
const Core=globalThis.LimitsCore;
const source=(await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(r=>setTimeout(r,0));
const settle=async()=>{for(let i=0;i<20;i++)await tick();};
function event(){const listeners=[];return {listeners,addListener:f=>listeners.push(f)};}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(provider,time){
  const used={chatgpt:38,claude:24,gemini:63,grok:50}[provider];
  return {key:provider+'-account',plan:'pro',label:provider+' · test',errors:[],usage:Core.parseUsage({rate_limit:{primary_window:{used_percent:used,limit_window_seconds:18000,reset_after_seconds:3600},secondary_window:{used_percent:used+1,limit_window_seconds:604800,reset_after_seconds:6000}}},time)};
}
async function worker({storage={},session={},time=Date.now(),load=fixture,active=1,open}={}){
  const badges=new Map(),alarms=new Map(),requests=[],actionWrites=[],scriptingCalls=[];let currentTime=time;
  const tabData=new Map((open||[{id:1,url:'https://chatgpt.com/'},{id:2,url:'https://claude.ai/new'},{id:3,url:'https://example.com/'},{id:4,url:'https://gemini.google.com/app'},{id:5,url:'https://claude.ai/chat/b'}]).map(t=>[t.id,t]));
  let selected=active,cookie='secret-seat-a';
  class Clock extends Date {static now(){return currentTime;}}
  class TestEngine extends Engine {constructor(options){super({...options,now:()=>currentTime});}}
  const chrome={runtime:{id:'test-extension',onMessage:event(),onInstalled:event(),onStartup:event()},
    storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,structuredClone(storage[k])])),set:async items=>Object.assign(storage,structuredClone(items))},session:{get:async keys=>Object.fromEntries(keys.map(k=>[k,structuredClone(session[k])])),set:async items=>Object.assign(session,structuredClone(items))}},
    action:Object.fromEntries(['setBadgeText','setBadgeBackgroundColor','setBadgeTextColor','setTitle'].map(name=>[name,async value=>{actionWrites.push({name,...value});if(name==='setBadgeText')badges.set(value.tabId,value.text);} ])),
    alarms:{get:async n=>alarms.get(n),create:async(n,v)=>alarms.set(n,v),clear:async n=>alarms.delete(n),onAlarm:event()},
    windows:{onFocusChanged:event(),WINDOW_ID_NONE:-1},
    cookies:{get:async()=>cookie?{value:cookie}:undefined,onChanged:event()},
    tabs:{get:async id=>{if(!tabData.has(id))throw new Error('closed');return structuredClone(tabData.get(id));},
      query:async q=>q.active?[tabData.get(selected)].filter(Boolean):[...tabData.values()].filter(t=>Core.providerForURL(t.url)&&(typeof q.url!=='string'||t.url.startsWith(q.url.replace('*','')))),create:async()=>{},onActivated:event(),onUpdated:event(),onRemoved:event()},
    scripting:{executeScript:async spec=>{
      scriptingCalls.push(spec.target.tabId);
      if(spec.files)return [];
      const t=tabData.get(spec.target.tabId),provider=Core.providerForURL(t?.url);if(!provider)throw new Error('context');
      const hint={chatgpt:'a',claude:'b',gemini:t.url.includes('/u/1')?'d':'c',grok:'e'}[provider].repeat(24);
      return [{frameId:0,result:{provider,hint,scope:provider==='chatgpt'?'chatgpt':provider+':'+hint,org:provider==='claude'?'org-chat-001':null,accountIndex:t.url.includes('/u/1')?1:0}}];
    }} };
  const context=vm.createContext({LimitsCore:Core,Engine:TestEngine,ResetMarkers,markerKey,chrome,fingerprint,structuredClone,URL,Date:Clock,grokSession:async()=>cookie?fingerprint('grok/'+cookie):null,prepareClaude:async()=>{},readClaudeStream:async()=>null,loadProvider:async ctx=>{requests.push({provider:ctx.provider,scope:ctx.scope});return load(ctx.provider,currentTime,ctx);}});
  new vm.Script(source,{filename:'background.js'}).runInContext(context);await settle();
  const message=(body,id)=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0](body,id?{id:'test-extension',tab:tabData.get(id),url:tabData.get(id)?.url}:{id:'test-extension'},resolve));
  const alarm=async name=>{chrome.alarms.onAlarm.listeners[0]({name});await settle();};
  return {storage,session,badges,requests,alarms,message,alarm,actionWrites,scriptingCalls,advance:ms=>{currentTime+=ms;},
    activate:async id=>{selected=id;chrome.tabs.onActivated.listeners[0]({tabId:id});await settle();},
    navigate:async(id,url)=>{Object.assign(tabData.get(id),{url});chrome.tabs.onUpdated.listeners[0](id,{url,status:'loading'},tabData.get(id));await settle();chrome.tabs.onUpdated.listeners[0](id,{status:'complete'},tabData.get(id));await settle();},
    spa:async(id,url)=>{Object.assign(tabData.get(id),{url});chrome.tabs.onUpdated.listeners[0](id,{url},tabData.get(id));await settle();},
    changeGrokSession:async value=>{cookie=value;chrome.cookies.onChanged.listeners[0]({cookie:{name:'sso',domain:'.grok.com'},removed:!value,cause:'explicit'});await settle();},
    changeSession:async value=>{cookie=value;chrome.cookies.onChanged.listeners[0]({cookie:{name:'sessionKey',domain:'.claude.ai'},removed:!value,cause:'explicit'});await settle();}};
}
test('each provider has its own values; same-account tabs share one request; unsupported badge is empty',async()=>{
  const w=await worker();assert.equal(w.requests.length,3);assert.equal(w.storage.activeView.provider,'chatgpt');
  assert.match(w.badges.get(1),/^(62|61)%$/);assert.match(w.badges.get(2),/^(76|75)%$/);assert.match(w.badges.get(4),/^(37|36)%$/);
  assert.equal(w.badges.get(2),w.badges.get(5));assert.equal(w.alarms.get('badge').periodInMinutes,.5);
  await w.activate(3);assert.equal(w.badges.get(3),'');assert.equal(w.storage.activeView.unsupported,true);assert.equal(w.storage.activeView.snapshot,null);
  assert(w.actionWrites.filter(x=>x.name==='setBadgeText'&&x.tabId===undefined).every(x=>x.text===''));
});
test('popup follows active tab; used/left and rotation do not trigger HTTP polls',async()=>{
  const w=await worker();await w.activate(4);await w.message({type:'popup'});assert.equal(w.storage.activeView.provider,'gemini');
  await w.message({type:'settings',value:{mode:'used'}});assert.match(w.badges.get(4),/^(63|64)%$/);assert.match(w.badges.get(2),/^(24|25)%$/);
  const before=w.badges.get(4);w.advance(30000);await w.alarm('badge');assert.notEqual(w.badges.get(4),before);assert.equal(w.requests.length,3);
});
test('worker restart restores cache without HTTP on badge rotation',async()=>{
  const now=Date.now(),w=await worker({time:now}),restarted=await worker({storage:w.storage,session:w.session,time:now+30000});assert.equal(restarted.requests.length,0);assert.equal(restarted.scriptingCalls.length,0);
  const before=restarted.badges.get(1);restarted.advance(30000);await restarted.alarm('badge');assert.notEqual(restarted.badges.get(1),before);assert.equal(restarted.requests.length,0);assert.equal(restarted.scriptingCalls.length,0);restarted.advance(5*60000);await restarted.alarm('refresh');assert.equal(restarted.requests.length,3);
});
test('late Claude response cannot populate a non-chat active tab or a Gemini widget',async()=>{
  const gate=deferred(),w=await worker({load:(p,t)=>p==='claude'?gate.promise:fixture(p,t)});
  await w.activate(3);gate.resolve(fixture('claude',Date.now()));await settle();assert.equal(w.badges.get(3),'');assert.equal(w.storage.activeView.snapshot,null);
  assert.equal(w.storage.tabViews[4].provider,'gemini');assert.equal(w.storage.tabViews[4].snapshot.usage.windows[0].used,63);
});
test('navigation clears old percentages and does not zero a different tab',async()=>{
  const w=await worker(),before=w.badges.get(5);await w.navigate(2,'https://example.com/');assert.equal(w.badges.get(2),'');assert.equal(w.badges.get(5),before);
  await w.navigate(2,'https://gemini.google.com/app');assert.match(w.badges.get(2),/^(37|36)%$/);assert.equal(w.requests.length,3);
});
test('Google account indexes have separate contexts and cookies are not persisted',async()=>{
  const w=await worker();await w.navigate(3,'https://gemini.google.com/u/1/app');assert.equal(w.requests.filter(r=>r.provider==='gemini').length,2);
  assert.notEqual(w.storage.tabViews[3].scope,w.storage.tabViews[4].scope);assert(!JSON.stringify(w.storage).includes('secret-seat-a'));
});
test('Claude logout immediately hides prior-seat data; new session gets a different scope',async()=>{
  const w=await worker(),old=w.storage.tabViews[2].scope;await w.changeSession('');assert.equal(w.storage.tabViews[2].snapshot,null);assert.equal(w.badges.get(2),'!');
  await w.changeSession('secret-seat-b');assert.notEqual(w.storage.tabViews[2].scope,old);assert.equal(w.requests.filter(r=>r.provider==='claude').length,2);assert(!JSON.stringify(w.storage).includes('secret-seat-b'));
});
test('same-provider SPA navigation does not blank the badge',async()=>{
 const w=await worker(),before=w.actionWrites.length;await w.spa(1,'https://chatgpt.com/c/new-chat');
 const changed=w.actionWrites.slice(before).filter(x=>x.name==='setBadgeText'&&x.tabId===1);
 assert(changed.length>0);assert(changed.every(x=>x.text!==''));assert.equal(w.storage.tabViews[1].snapshot.usage.windows[0].used,38);
});
test('upgrade clears old Gemini transport cooldown while preserving a captured descriptor',async()=>{
 const w=await worker(),scope=w.storage.tabViews[4].scope;
 w.storage.providerBuild='0.3.2';w.storage.providerStates[scope].providerState={jsonRetryAt:Date.now()+1800000,domRetryAt:Date.now()+600000,geminiQuery:{signature:'retained-signature'}};
 const next=await worker({storage:w.storage,session:w.session});
 assert.equal(next.storage.providerStates[scope].providerState.jsonRetryAt,0);assert.equal(next.storage.providerStates[scope].providerState.domRetryAt,0);assert.equal(next.storage.providerStates[scope].providerState.geminiQuery.signature,'retained-signature');
});

test('Grok tabs share updates; logout hides both badges and a new login gets a new cache',async()=>{
 const w=await worker({open:[{id:1,url:'https://grok.com/'},{id:2,url:'https://grok.com/c/other'}]});
 assert.equal(w.requests.length,1);assert.equal(w.storage.tabViews[1].provider,'grok');assert.equal(w.badges.get(1),w.badges.get(2));assert.match(w.badges.get(1),/^(50|49)%$/);
 const old=w.storage.tabViews[1].scope;await w.changeGrokSession('');assert.equal(w.storage.tabViews[1].snapshot,null);assert.equal(w.storage.tabViews[2].snapshot,null);assert.equal(w.badges.get(1),'!');
 await w.changeGrokSession('secret-grok-b');assert.notEqual(w.storage.tabViews[1].scope,old);assert.equal(w.requests.length,2);assert(!JSON.stringify(w.storage).includes('secret-grok-b'));
});
test('configured background reset marks same-account tabs once, survives worker restart, and clears on viewing',async()=>{
 const at=Date.now(),deadline=at+120000;
 const open=[{id:1,url:'https://chatgpt.com/'},{id:3,url:'https://example.com/'},{id:4,url:'https://gemini.google.com/app'},{id:6,url:'https://gemini.google.com/app/other'}];
 const load=(p,t)=>{const b=fixture(p,t);if(p==='gemini'){b.usage.windows[0].used=t<deadline?95:3;b.usage.windows[0].resetAt=t<deadline?deadline:deadline+18000000;}return b;};
 const w=await worker({time:at,open,load});assert(!w.storage.tabViews[4].resetMarker);
 await w.activate(4);const key=w.storage.activeView.resetMarkers.key;
 assert.equal((await w.message({type:'reset-marker-settings',key,enabled:true,quotas:['window:main:primary']})).ok,true);
 assert(w.alarms.get('quota-reset'));await w.activate(3);w.advance(121000);await w.alarm('quota-reset');
 assert(w.storage.tabViews[4].resetMarker);assert(w.storage.tabViews[6].resetMarker);assert(!w.storage.tabViews[1].resetMarker);assert.equal(w.badges.get(3),'');
 const next=await worker({storage:w.storage,session:w.session,time:deadline+2000,open,load,active:3});
 assert(next.storage.tabViews[4].resetMarker);await next.activate(6);
 assert(!next.storage.tabViews[4].resetMarker);assert(!next.storage.tabViews[6].resetMarker);
 next.advance(60000);await next.alarm('refresh');assert(!next.storage.tabViews[4].resetMarker);
});
test('marker settings cannot be forged by a page or applied after a provider switch',async()=>{
 const w=await worker();await w.activate(4);const key=w.storage.activeView.resetMarkers.key;
 assert.equal((await w.message({type:'reset-marker-settings',key,enabled:true,quotas:[]},4)).ok,false);
 await w.activate(2);assert.equal((await w.message({type:'reset-marker-settings',key,enabled:true,quotas:[]})).ok,false);
 assert(!w.storage.activeView.resetMarkers.enabled);
});

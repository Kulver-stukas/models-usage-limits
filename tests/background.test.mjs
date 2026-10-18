import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {Engine} from '../extension/engine.mjs';
import '../extension/shared.js';
const Core=globalThis.LimitsCore;
const source=(await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(r=>setTimeout(r,0));
function event(){const listeners=[];return {listeners,addListener:f=>listeners.push(f)};}
function fixture(time) {
  return {key:'account-a',plan:'team',label:'BUSINESS · test',errors:[],usage:Core.parseUsage({plan_type:'team',rate_limit:{primary_window:{used_percent:38,limit_window_seconds:18000,reset_after_seconds:3600},secondary_window:{used_percent:19,limit_window_seconds:604800,reset_after_seconds:6000}}},time),init:Core.parseInit({limits_progress:[]},time)};
}
async function worker(storage={},time=Date.now()) {
  const badge={},alarms=new Map(),requests=[];let currentTime=time;
  class Clock extends Date {static now(){return currentTime;}}
  class TestEngine extends Engine {constructor(options){super({...options,now:()=>currentTime});}}
  const chrome={runtime:{id:'test-extension',onMessage:event(),onInstalled:event(),onStartup:event()},
    storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,structuredClone(storage[k])])),set:async items=>Object.assign(storage,structuredClone(items))}},
    action:{setBadgeText:async v=>badge.text=v.text,setBadgeBackgroundColor:async v=>badge.color=v.color,setBadgeTextColor:async()=>{},setTitle:async v=>badge.title=v.title},
    alarms:{get:async n=>alarms.get(n),create:async(n,v)=>alarms.set(n,v),onAlarm:event()},
    tabs:{query:async()=>[],create:async()=>{}},scripting:{executeScript:async()=>{}}};
  const context=vm.createContext({LimitsCore:Core,Engine:TestEngine,chrome,structuredClone,Date:Clock,loadBundle:async()=>{requests.push(currentTime);return fixture(currentTime);}});
  new vm.Script(source,{filename:'background.js'}).runInContext(context);
  for(let i=0;i<8;i++)await tick();
  const message=body=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0](body,{id:'test-extension'},resolve));
  const alarm=async name=>{chrome.alarms.onAlarm.listeners[0]({name});for(let i=0;i<5;i++)await tick();};
  return {storage,badge,requests,alarms,message,alarm,advance:ms=>{currentTime+=ms;}};
}
test('worker startup, UI refresh, settings and alarms use one source of truth',async()=>{
  const w=await worker();assert.equal(w.requests.length,1);
  assert.equal(w.alarms.get('badge').periodInMinutes,0.5);assert.equal(w.storage.publicView.snapshot.usage.windows.length,2);
  await w.message({type:'settings',value:{mode:'used',widget:false}});
  assert.equal(w.storage.settings.mode,'used');assert.match(w.badge.text,/^(38|19)%$/);
  await w.message({type:'settings',value:{mode:'left'}});assert.match(w.badge.text,/^(62|81)%$/);
  const first=w.badge.text;w.advance(30000);await w.alarm('badge');assert.notEqual(w.badge.text,first);
  assert.equal(w.requests.length,1);
});
test('suspended worker restart restores cache without polling on every badge tick',async()=>{
  const now=Date.now(),w=await worker({},now),before=w.storage.publicView.revision;
  const restarted=await worker(w.storage,now+30000);
  assert.equal(restarted.requests.length,0);assert(restarted.storage.publicView.revision>before);
  await restarted.alarm('badge');assert.equal(restarted.requests.length,0);
  restarted.advance(5*60000);await restarted.alarm('refresh');assert.equal(restarted.requests.length,1);
});

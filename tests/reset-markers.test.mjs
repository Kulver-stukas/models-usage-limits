import test from 'node:test';
import assert from 'node:assert/strict';
import {ResetMarkers,markerKey,markerQuotas} from '../extension/reset-markers.mjs';
const start=1800000000000,reset=start+3600000;
const key=markerKey('gemini','account-a','pro');
const view=(used=95,at=start,end=reset,more={})=>({provider:'gemini',checking:false,snapshot:{plan:'pro',usage:{fetchedAt:at,
  windows:[{id:'five',label:'5-hour limit',seconds:18000,used,resetAt:end,...more}]}}});
const enable=(m,v=view(),ids=['window:five'])=>m.configure(key,true,ids,v,start);
test('disabled by default; selected quotas arm only at 90% and require a fresh new window',()=>{
 const m=new ResetMarkers();m.update(key,view(),start);assert.equal(m.nextReset(start),null);
 enable(m);m.update(key,view(89.99),start);assert.equal(m.nextReset(start),null);
 m.update(key,view(95,start+1),start+1);assert.equal(m.nextReset(start),reset);
 m.update(key,view(),reset+1000);assert(!m.pending(key,reset+1000));
 m.update(key,view(94,reset+2000,reset+18000000),reset+2000);assert(!m.pending(key,reset+2000));
 m.update(key,view(2,reset+18000001,reset+36000000),reset+18000001);assert(m.pending(key,reset+18000001));
});
test('one pending event shared by tabs, acknowledgement survives restart without replay',()=>{
 const m=new ResetMarkers();enable(m);m.update(key,view(),start);
 const restored=new ResetMarkers(m.export());restored.update(key,view(3,reset+1000,reset+18000000),reset+1000);
 assert(restored.pending(key,reset+1000));restored.acknowledge(key);
 const again=new ResetMarkers(restored.export());again.update(key,view(3,reset+1000,reset+18000000),reset+2000);
 assert(!again.pending(key,reset+2000));
});
test('visible account, errors, cached zero, and an ordinary early decrease do not create events',()=>{
 for(const kind of ['visible','error','cached','early']){
  const m=new ResetMarkers();enable(m);m.update(key,view(),start);
  const now=kind==='early'?start+5000:reset+5000,v=view(0,kind==='cached'?start+1000:now,reset+18000000);
  if(kind==='error')v.error='network';m.update(key,v,now,kind==='visible');assert(!m.pending(key,now),kind);
 }
});
test('late or absent windows are never zero; moving future timestamps are rescheduled',()=>{
 const m=new ResetMarkers();enable(m);m.update(key,view(),start);
 m.update(key,view(95,start+300000,reset+100000),start+300000);assert.equal(m.nextReset(start+300000),reset+100000);
 m.update(key,{snapshot:{usage:{windows:[],fetchedAt:reset+200000}}},reset+200000);assert(!m.pending(key,reset+200000));
 m.update(key,view(0,start+1000,reset+18000000),reset+200000);assert(!m.pending(key,reset+200000));
});
test('weekly/additional selections work independently, plan and account preferences stay separate',()=>{
 const m=new ResetMarkers(),v=view();v.snapshot.usage.windows.push({id:'week',label:'Weekly limit',seconds:604800,used:99,resetAt:reset});
 enable(m,v,['window:week']);m.update(key,v,start);assert.equal(Object.keys(m.records[key]).join(','),'window:week');
 const other=markerKey('gemini','account-b','pro'),free=markerKey('gemini','account-a','free');
 assert(!m.config(other).enabled);assert(!m.config(free).enabled);
 const next=structuredClone(v);next.snapshot.usage.fetchedAt=reset+1000;next.snapshot.usage.windows[1]={...next.snapshot.usage.windows[1],used:1,resetAt:reset+604800000};
 m.update(key,next,reset+1000);assert(m.pending(key,reset+1000));assert(!m.pending(key,reset+604800000));
});
test('event-only Claude, estimated DOM, count-only features and missing timestamps are disabled with reasons',()=>{
 for(const extra of [{observation:'event'},{resetFromText:true},{resetAt:null}]){
  const v=view(95,start,reset,extra);assert(!markerQuotas(v)[0].eligible);
  const m=new ResetMarkers();enable(m,v);m.update(key,v,start);assert.equal(m.nextReset(start),null);
 }
 const v=view();v.snapshot.init={features:[{id:'deep_research',label:'Deep research',remaining:0,resetAt:reset}]};assert(!markerQuotas(v)[1].eligible);
});
test('disabling, deselecting, restored eligibility changes, and a return to red clear dots',()=>{
 for(const action of ['disable','deselect','event','red']){
  const m=new ResetMarkers();enable(m);m.update(key,view(),start);m.update(key,view(1,reset+1000,reset+18000000),reset+1000);assert(m.pending(key,reset+1000));
  if(action==='disable')m.configure(key,false,['window:five'],view(),reset+2000);
  if(action==='deselect')m.configure(key,true,[],view(),reset+2000);
  if(action==='event')m.update(key,view(1,reset+2000,reset+18000000,{observation:'event'}),reset+2000);
  if(action==='red')m.update(key,view(90,reset+2000,reset+18000000),reset+2000);
  assert(!m.pending(key,reset+2000),action);
 }
});

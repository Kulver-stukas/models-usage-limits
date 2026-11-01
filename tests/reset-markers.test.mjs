import test from 'node:test';
import assert from 'node:assert/strict';
import {ResetMarkers,markerKey,markerQuotas} from '../extension/reset-markers.mjs';
const C=globalThis.LimitsCore,start=1800000000000,reset=start+3600000;
const key=markerKey('gemini','account-a','pro');
const view=(used=95,at=start,end=reset,more={})=>({provider:'gemini',checking:false,snapshot:{plan:'pro',usage:{fetchedAt:at,
  windows:[{id:'five',label:'5-hour limit',seconds:18000,used,resetAt:end,...more}]}}});
const counts=(remaining,at=start,reference=5)=>({provider:'chatgpt',checking:false,snapshot:{plan:'free',featureReferences:{image_gen:reference},
  init:{fetchedAt:at,features:[{id:'image_gen',label:'Image generation',remaining,resetAt:reset}]}}});
const enable=(m,v=view(),ids=['window:five'])=>m.configure(key,true,ids,v);
test('off by default; red follows widget tone; fresh recovery needs no deadline or new window',()=>{
 const m=new ResetMarkers();m.update(key,view(),start);assert.equal(m.color(key),null);
 enable(m);m.update(key,view(89.99),start);assert.equal(m.color(key),null);
 m.update(key,view(90,start+1),start+1);assert.equal(m.color(key),'red');assert.equal(m.nextReset(start),reset);
 m.acknowledge(key);assert.equal(m.color(key),'red');
 m.update(key,view(89,start+2),start+2);assert.equal(m.color(key),'green');assert.equal(m.nextReset(start),null);
});
test('count quotas use exactly the widget reference and down-rounded thresholds',()=>{
 for(const reference of [undefined,0,3,5,15,160])for(const remaining of [0,1,2,3,4,5,15,160]){
  const v=counts(remaining,start,reference),m=new ResetMarkers();
  if(reference===undefined)delete v.snapshot.featureReferences.image_gen;
  const q=markerQuotas(v)[0];
  assert.equal(q.critical,C.countTone(remaining,reference)==='critical');assert(q.eligible);
  enable(m,v,['feature:image_gen']);m.update(key,v,start);assert.equal(m.color(key),q.critical?'red':null);
 }
 const m=new ResetMarkers();enable(m,counts(1),['feature:image_gen']);m.update(key,counts(1),start);assert.equal(m.color(key),'red');
 // Recovery into amber is enough; a full refill and a later reset date are unnecessary.
 m.update(key,counts(2,start+1),start+1);assert.equal(m.color(key),'green');
 m.update(key,counts(1,start+2),start+2);assert.equal(m.color(key),'red');
});
test('zero without a known count allowance arms observation; first healthy reading does not',()=>{
 const m=new ResetMarkers();enable(m,counts(0,start,0),['feature:image_gen']);m.update(key,counts(0,start,0),start);assert.equal(m.color(key),'red');
 m.update(key,counts(5,start+1,5),start+1);assert.equal(m.color(key),'green');
 m.acknowledge(key);m.update(key,counts(5,start+2,5),start+2);assert.equal(m.color(key),null);
 const fresh=new ResetMarkers();enable(fresh,counts(5),['feature:image_gen']);fresh.update(key,counts(5),start);assert.equal(fresh.color(key),null);
});
test('red has priority across selected windows and features; unselected red is ignored',()=>{
 const both=(used,remaining,at)=>{const v=view(used,at);Object.assign(v.snapshot,counts(remaining,at).snapshot,{usage:v.snapshot.usage});return v;};
 const m=new ResetMarkers(),v=both(95,1,start);enable(m,v,['window:five','feature:image_gen']);m.update(key,v,start);
 m.update(key,both(0,1,start+1),start+1);assert.equal(m.color(key),'red');
 m.update(key,both(0,2,start+2),start+2);assert.equal(m.color(key),'green');
 m.acknowledge(key);assert.equal(m.color(key),null);
 enable(m,v,['feature:image_gen']);m.update(key,both(95,2,start+3),start+3);assert.equal(m.color(key),null);
});
test('errors, missing quotas, stale or unchanged readings and a passed timer do not recover',()=>{
 for(const kind of ['error','checking','cached','stale','future','missing','invalid','deadline']){
  const m=new ResetMarkers();enable(m);m.update(key,view(),start);
  const now=reset+1000,v=view(0,now,reset+18000000);
  if(kind==='error')v.error='usage: network';
  if(kind==='checking')v.checking=true;
  if(kind==='cached')v.snapshot.usage.fetchedAt=start;
  if(kind==='stale')v.snapshot.usage.fetchedAt=now-11*60000;
  if(kind==='future')v.snapshot.usage.fetchedAt=now+61000;
  if(kind==='missing')v.snapshot.usage.windows=[];
  if(kind==='invalid')v.snapshot.usage.windows[0].used=null;
  if(kind==='deadline')v.snapshot.usage.windows[0].used=95;
  m.update(key,v,now);assert.equal(m.color(key),'red',kind);
 }
});
test('feature and usage failures/fetch times are independent, even without main usage',()=>{
 const both=(at)=>{const v=view(95,at);Object.assign(v.snapshot,counts(1,at).snapshot,{usage:v.snapshot.usage});return v;};
 const m=new ResetMarkers();enable(m,both(start),['feature:image_gen','window:five']);m.update(key,both(start),start);
 const v=both(start+1);v.error='usage: network';v.snapshot.init.features[0].remaining=5;m.update(key,v,start+1);
 assert.equal(m.records[key]['feature:image_gen'].red,false);assert.equal(m.color(key),'red');
 const next=both(start+2);next.error='features: rate';next.snapshot.usage.windows[0].used=0;m.update(key,next,start+2);assert.equal(m.color(key),'green');
 // A refreshed plan response must not make an unchanged cached feature count fresh.
 const n=new ResetMarkers();enable(n,counts(1),['feature:image_gen']);n.update(key,counts(1),start);
 n.update(key,{...counts(5),error:'features: network'},start+1);assert.equal(n.color(key),'red');
 n.update(key,counts(5),start+2);assert.equal(n.color(key),'red');
 n.update(key,{...counts(5,start+3),error:'usage: network'},start+3);assert.equal(n.color(key),'green');
});
test('event-only, estimated and no-timestamp quotas are eligible; only numeric observations change state',()=>{
 for(const extra of [{observation:'event'},{resetFromText:true},{resetAt:null}]){
  const v=view(95,start,reset,extra),m=new ResetMarkers();assert(markerQuotas(v)[0].eligible);enable(m,v);m.update(key,v,start);assert.equal(m.color(key),'red');
  m.update(key,view(0,start+1,reset,extra),start+1);assert.equal(m.color(key),'green');
 }
 const v=view(95,start,null,{observation:'event'});assert.match(markerQuotas(v)[0].reason,/normal chat reply/);
});
test('recovery and acknowledgement survive restart without replay; account and plan remain separate',()=>{
 const m=new ResetMarkers();enable(m);m.update(key,view(),start);
 const restored=new ResetMarkers(m.export());assert.equal(restored.color(key),'red');restored.update(key,view(3,start+1),start+1);assert.equal(restored.color(key),'green');
 const again=new ResetMarkers(restored.export());assert.equal(again.color(key),'green');again.acknowledge(key);
 const seen=new ResetMarkers(again.export());seen.update(key,view(3,start+2),start+2);assert.equal(seen.color(key),null);
 for(const other of [markerKey('gemini','account-b','pro'),markerKey('gemini','account-a','free'),markerKey('claude','account-a','pro')]){
  assert(!seen.config(other).enabled);assert.equal(seen.color(other),null);
 }
});
test('0.3.7 upgrade preserves preferences, armed red state and unacknowledged recovery',()=>{
 const signature=JSON.stringify(['5-hour limit',18000]);
 for(const [old,colour] of [[{armed:reset},'red'],[{pending:{until:reset}},'green'],[{},null]]){
  const m=new ResetMarkers({preferences:{[key]:{enabled:true,quotas:['window:five']}},records:{[key]:{'window:five':{at:start,signature,...old}}}});
  assert.equal(m.color(key),colour);assert.equal(m.export().schema,2);
  if(colour==='red'){m.update(key,view(0,start+1),start+1);assert.equal(m.color(key),'green');}
 }
});
test('disable and deselect clear observations; dates only schedule an earlier check',()=>{
 for(const enabled of [true,false]){
  const m=new ResetMarkers();enable(m);m.update(key,view(),start);
  m.configure(key,enabled,[],view());assert.equal(m.color(key),null);assert.equal(m.nextReset(start),null);
 }
 const m=new ResetMarkers();enable(m);m.update(key,view(),start);
 m.update(key,view(95,start+1,reset+1000),start+1);assert.equal(m.nextReset(start+1),reset+1000);assert.equal(m.color(key),'red');
});
test('first plan identification moves observation once and respects existing plan settings',()=>{
 const unknown=markerKey('gemini','account-a',null),known=key;
 const m=new ResetMarkers();m.configure(unknown,true,['window:five'],view());m.update(unknown,view(),start);
 m.identifyPlan(unknown,known);assert.equal(m.color(known),'red');assert(!m.config(unknown).enabled);
 const restored=new ResetMarkers(m.export());restored.update(known,view(3,start+1),start+1);assert.equal(restored.color(known),'green');
 const n=new ResetMarkers();n.configure(unknown,true,['window:five'],view());n.update(unknown,view(),start);
 n.configure(known,false,[],view());n.identifyPlan(unknown,known);assert(!n.config(known).enabled);assert.equal(n.color(known),null);
});

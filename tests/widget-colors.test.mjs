import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/shared.js';
import {Engine} from '../extension/engine.mjs';
const C=globalThis.LimitsCore;
test('widget numbers warn at 70 percent and turn critical at 90 percent',()=>{
 assert.equal(C.usageTone(69.99),'normal');assert.equal(C.usageTone(70),'warning');assert.equal(C.usageTone(89.99),'warning');assert.equal(C.usageTone(90),'critical');assert.equal(C.usageTone(100),'critical');
 assert.equal(C.usageTone(null),'normal');
 // The popup and toolbar retain their existing palette.
 assert.equal(C.color(85),'#d74444');
});
test('widget bars interpolate continuously through amber and clamp at red',()=>{
 assert.equal(C.usageBarColor(0),'#269b78');assert.equal(C.usageBarColor(70),'#d6a02c');assert.equal(C.usageBarColor(90),'#dc4549');
 assert.notEqual(C.usageBarColor(30),C.usageBarColor(31));assert.notEqual(C.usageBarColor(70),C.usageBarColor(71));assert.equal(C.usageBarColor(100),C.usageBarColor(90));assert.equal(C.usageBarColor(-1),C.usageBarColor(0));
});
test('five-count reference warns at two left and is critical at one or zero',()=>{
 assert.deepEqual([5,4,3,2,1,0].map(n=>C.countTone(n,5)),['normal','normal','normal','warning','critical','critical']);
 assert.equal(C.countTone(5,15),'warning');assert.equal(C.countTone(2,15),'critical');
 assert.equal(C.countTone(1,1),'normal');assert.equal(C.countTone(1,null),'normal');assert.equal(C.countTone(0,null),'critical');assert.equal(C.countTone(null,5),'normal');
});
test('observed count references survive restart and remain isolated by account and plan',async()=>{
 let now=1800000000000,saved,key='seat-a',plan='free',remaining=5;
 const load=async()=>({key,plan,label:'Test',usage:{windows:[],fetchedAt:now},init:C.parseInit({limits_progress:[{feature_name:'image_gen',remaining}]},now),errors:[]});
 const options={load,save:async state=>{saved=state;},now:()=>now};
 let engine=new Engine(options);await engine.refresh();assert.equal(engine.view().snapshot.featureReferences.image_gen,5);
 remaining=2;now+=60000;await engine.refresh();assert.equal(C.countTone(2,engine.view().snapshot.featureReferences.image_gen),'warning');
 engine=new Engine({...options,initial:saved});remaining=1;now+=60000;await engine.refresh();assert.equal(C.countTone(1,engine.view().snapshot.featureReferences.image_gen),'critical');
 key='seat-b';remaining=2;now+=60000;await engine.refresh();assert.equal(engine.view().snapshot.featureReferences.image_gen,2);
 plan='team';remaining=120;now+=60000;await engine.refresh();assert.equal(engine.view().snapshot.featureReferences.image_gen,120);
 plan='free';remaining=1;now+=60000;await engine.refresh();assert.equal(engine.view().snapshot.featureReferences.image_gen,1);
});
test('an existing cache supplies the initial reference without inventing a plan allowance',async()=>{
 const now=1800000000000,old={plan:'free',init:C.parseInit({limits_progress:[{feature_name:'deep_research',remaining:5}]},now-60000)};
 const engine=new Engine({initial:{accounts:{seat:old},selected:'seat'},now:()=>now,save:async()=>{},load:async()=>({key:'seat',plan:'free',init:C.parseInit({limits_progress:[{feature_name:'deep_research',remaining:2}]},now),errors:[]})});
 await engine.refresh();assert.equal(engine.view().snapshot.featureReferences.deep_research,5);
 assert(!('limit' in engine.view().snapshot.init.features[0]));assert(!('usedPercent' in engine.view().snapshot.init.features[0]));
});

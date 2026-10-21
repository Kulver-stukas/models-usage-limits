import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseGrokFree,decodeGrokCredits,loadGrok,grokSession,requestGrokInTab} from '../extension/grok.mjs';
import '../extension/shared.js';
const C=globalThis.LimitsCore,now=1792600000000;
const free={windowSizeSeconds:86400,remainingQueries:30,totalQueries:30,lowEffortRateLimits:null,highEffortRateLimits:null};
const concat=(...b)=>Uint8Array.from(b.flatMap(x=>Array.from(x)));
function vi(n){const a=[];do{const b=n%128;n=Math.floor(n/128);a.push(b+(n?128:0));}while(n);return Uint8Array.from(a);}
const field=(id,b)=>concat(vi(id*8+2),vi(b.length),b);
const integer=(id,n)=>concat(vi(id*8),vi(n));
const float=(id,n)=>{const b=new Uint8Array(4);new DataView(b.buffer).setFloat32(0,n,true);return concat(vi(id*8+5),b);};
function frame(body,flag=0){const head=new Uint8Array(5);head[0]=flag;new DataView(head.buffer).setUint32(1,body.length);return concat(head,body);}
function paid({used=26,reset=true,products=true,status='0',omitUsed=false,unknown=false}={}){
 const config=concat(omitUsed?[]:float(1,used),reset?field(5,integer(1,1792800000)):[],products?field(7,concat(integer(1,4),float(2,20))):[],unknown?integer(100,1):[]);
 return {bytes:Array.from(concat(frame(field(1,config)),frame(new TextEncoder().encode('grpc-status: '+status+'\r\n'),128))),status:null};
}
test('Free uses actual daily window and counts, never guesses a reset',()=>{
 const u=parseGrokFree(free,now);assert.equal(u.windows[0].used,0);assert.equal(u.windows[0].seconds,86400);assert.equal(u.windows[0].remaining,30);assert.equal(u.windows[0].resetAt,null);
 assert.equal(parseGrokFree({...free,remainingQueries:15}).windows[0].used,50);assert.equal(parseGrokFree({...free,remainingQueries:0}).reached,true);
 for(const bad of [{totalQueries:null},{remainingQueries:null},{remainingQueries:'0'},{remainingQueries:31},{windowSizeSeconds:0},{totalQueries:0},{remainingQueries:-1}])assert.throws(()=>parseGrokFree({...free,...bad}),/format/);
});
test('paid decodes shared usage, server timestamp and product contributions',()=>{
 const u=decodeGrokCredits(paid());assert.equal(u.used,26);assert.equal(u.resetAt,1792800000000);assert.deepEqual(u.products,[{id:4,label:'Chat',percent:20}]);
 assert.equal(decodeGrokCredits(paid({used:0})).used,0);assert.equal(decodeGrokCredits(paid({omitUsed:true})).used,0);
 assert.throws(()=>decodeGrokCredits(paid({omitUsed:true,reset:false,products:false,unknown:true})),/format/);
 for(const used of [-1,101,NaN,Infinity])assert.throws(()=>decodeGrokCredits(paid({used})),/format/);
});
test('gRPC HTTP-success error trailers cannot become usage',()=>{
 for(const [status,error] of [['16','auth'],['8','rate'],['13','network']])assert.throws(()=>decodeGrokCredits(paid({status})),new RegExp(error));
 assert.throws(()=>decodeGrokCredits({...paid(),status:'13'}),/format/);
});
test('bounded decoder rejects truncated, compressed, duplicate and malformed frames',()=>{
 const good=paid();for(let n=0;n<good.bytes.length;n++)assert.throws(()=>decodeGrokCredits({bytes:good.bytes.slice(0,n),status:'13'}));
 const compressed=structuredClone(good);compressed.bytes[0]=1;assert.throws(()=>decodeGrokCredits(compressed),/format/);
 assert.throws(()=>decodeGrokCredits({bytes:[0,255,255,255,255]}),/format/);
 assert.throws(()=>decodeGrokCredits({bytes:[999]}),/format/);
 const invalid=frame(field(1,Uint8Array.from([10,255])));assert.throws(()=>decodeGrokCredits({bytes:Array.from(invalid)}),/format/);
 const duplicate=frame(concat(field(1,float(1,2)),field(1,float(1,3))));assert.throws(()=>decodeGrokCredits({bytes:Array.from(duplicate)}),/format/);
});
test('tier detection selects only the correct endpoint; result has no credentials',async()=>{
 for(const active of [false,true]){
  const calls=[],session='fingerprinted-secret',request=async kind=>{calls.push(kind);return kind==='subscriptions'?{subscriptions:active?[{status:'SUBSCRIPTION_STATUS_ACTIVE'}]:[]}:active?paid():free;};
  const result=await loadGrok({sessionHash:session},request,async()=>session,()=>now);
  assert.deepEqual(calls,['subscriptions',active?'paid':'free']);assert.equal(result.plan,active?'paid':'free');assert(!JSON.stringify(result).includes(session));
  if(active)assert.match(result.usage.notice,/experimental/);else assert.equal(result.usage.windows[0].resetAt,null);
 }
});
test('invalid subscriptions are unknown, never silently free; errors do not fall back',async()=>{
 for(const data of [{},{subscriptions:null},{subscriptions:[{}]}])await assert.rejects(()=>loadGrok({sessionHash:'s'},async()=>data,async()=>'s'),/format/);
 const calls=[];await assert.rejects(()=>loadGrok({sessionHash:'s'},async kind=>{calls.push(kind);throw Error('network');},async()=>'s'),/network/);assert.deepEqual(calls,['subscriptions']);
});
test('account switches in flight are rejected; different sessions have separate keys',async()=>{
 const request=async k=>k==='subscriptions'?{subscriptions:[]}:free;
 let n=0;await assert.rejects(()=>loadGrok({sessionHash:'a'},request,async()=>++n===1?'a':'b'),/context/);
 await assert.rejects(()=>loadGrok({sessionHash:'a'},request,async()=>'b'),/context/);
 await assert.rejects(()=>loadGrok({},request,async()=>null),/auth/);
 const a=await loadGrok({sessionHash:'a'},request,async()=>'a'),b=await loadGrok({sessionHash:'b'},request,async()=>'b');assert.notEqual(a.key,b.key);
});
test('cookie fingerprint prefers sso, handles fallback and missing login without persisting raw values',async()=>{
 const calls=[],s=await grokSession({get:async args=>{calls.push(args.name);return {value:'raw-cookie'};}});assert.deepEqual(calls,['sso']);assert.match(s,/^[a-f0-9]{24}$/);assert(!s.includes('raw-cookie'));
 assert.notEqual(s,await grokSession({get:async args=>args.name==='sso-rw'?{value:'raw-cookie'}:null}));assert.equal(await grokSession({get:async()=>null}),null);
});
test('Grok URL routing excludes APIs, public shares and lookalike origins',()=>{
 assert.equal(C.providerForURL('https://grok.com/c/abc'),'grok');
 for(const url of ['http://grok.com/','https://grok.com.evil.test/','https://grok.com/rest/rate-limits','https://grok.com/share/abc','https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig'])assert.equal(C.providerForURL(url),null);
});
test('tab request is allowlisted, cookie-authenticated and sends no model generation request',async()=>{
 const calls=[];function run(kind,host='grok.com',status=200){const context=vm.createContext({location:{hostname:host,protocol:'https:',origin:'https://'+host},Uint8Array,TextDecoder,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return {ok:status===200,status,headers:new Headers({'content-type':'application/json'}),arrayBuffer:async()=>new TextEncoder().encode(JSON.stringify(free)).buffer};}});return vm.runInContext('('+requestGrokInTab.toString()+')('+JSON.stringify(kind)+')',context);}
 assert.equal((await run('free')).ok,true);assert.equal(calls[0].options.credentials,'include');assert.deepEqual(JSON.parse(calls[0].options.body),{requestKind:'DEFAULT',modelName:'grok-3'});
 assert.equal((await run('completion')).error,'context');assert.equal((await run('free','evil.test')).error,'context');assert.equal(calls.length,1);assert.equal((await run('free','grok.com',401)).error,'auth');assert.equal((await run('free','grok.com',429)).error,'rate');
});

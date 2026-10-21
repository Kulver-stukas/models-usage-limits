import './shared.js';
import {fingerprint} from './api.mjs';
const C=globalThis.LimitsCore;
const MAX=2*1024*1024;

// Read only the login cookie needed to partition the quota cache. Raw values
// never leave this function and are never sent to another provider.
export async function grokSession(cookies=chrome.cookies){
  for(const name of ['sso','sso-rw']){
    const cookie=await cookies.get({url:'https://grok.com/',name});
    if(cookie?.value)return fingerprint('grok/'+name+'/'+cookie.value);
  }
  return null;
}

// Self-contained function executed in the isolated world of a Grok tab.
export async function requestGrokInTab(kind){
  try{
    if(location.hostname!=='grok.com'||location.protocol!=='https:')throw Error('context');
    const paths={subscriptions:'/rest/subscriptions',free:'/rest/rate-limits',paid:'/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig'};
    if(!Object.hasOwn(paths,kind))throw Error('context');
    const binary=kind==='paid',post=kind!=='subscriptions';
    const response=await fetch(location.origin+paths[kind],{
      method:post?'POST':'GET',credentials:'include',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000),
      headers:binary?{'Content-Type':'application/grpc-web+proto','X-Grpc-Web':'1'}:post?{'Content-Type':'application/json',Accept:'application/json'}:{Accept:'application/json'},
      ...(post?{body:binary?new Uint8Array(5):JSON.stringify({requestKind:'DEFAULT',modelName:'grok-3'})}:{})
    });
    if(!response.ok)return {ok:false,error:response.status===401||response.status===403?'auth':response.status===429?'rate':'network',detail:'HTTP '+response.status};
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length>2*1024*1024)throw Error('format');
    if(binary){
      const type=response.headers.get('content-type')||'';
      if(!type.includes('application/grpc-web'))throw Error('format');
      return {ok:true,data:{bytes:Array.from(bytes),status:response.headers.get('grpc-status')}};
    }
    try{return {ok:true,data:JSON.parse(new TextDecoder().decode(bytes))};}catch{throw Error('format');}
  }catch(e){return {ok:false,error:['context','auth','rate','format'].includes(e.message)?e.message:'network',detail:['TypeError','TimeoutError','AbortError'].includes(e.name)?e.name:'Quota request or parsing failed'};}
}
export async function requestGrok(tabId,kind){
  const results=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:requestGrokInTab,args:[kind]});
  const result=results.find(v=>v.frameId===0)?.result;
  if(!result?.ok){const e=Error(result?.error||'network');e.diagnostics={attempts:[{stage:'Grok '+kind,detail:result?.detail||'Request unavailable'}]};throw e;}
  return result.data;
}
function fields(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length>MAX)throw Error('format');
  let at=0,count=0;const out=new Map();
  function integer(){let n=0;for(let i=0;i<10;i++){if(at>=bytes.length)throw Error('format');const b=bytes[at++];n+=(b&127)*2**(7*i);if(!Number.isSafeInteger(n))throw Error('format');if(!(b&128))return n;}throw Error('format');}
  while(at<bytes.length){
    if(++count>10000)throw Error('format');
    const tag=integer(),id=Math.floor(tag/8),wire=tag%8;if(!id||id>536870911)throw Error('format');let value;
    if(wire===0)value=integer();
    else if(wire===2){const length=integer();if(length>bytes.length-at)throw Error('format');value=bytes.subarray(at,at+length);at+=length;}
    else if(wire===1||wire===5){const size=wire===1?8:4;if(size>bytes.length-at)throw Error('format');const view=new DataView(bytes.buffer,bytes.byteOffset+at,size);value=wire===1?view.getFloat64(0,true):view.getFloat32(0,true);at+=size;}
    else throw Error('format');
    const list=out.get(id)||[];list.push({wire,value});out.set(id,list);
  }
  return out;
}
function one(map,id,wire){
  const list=map.get(id);if(!list)return undefined;
  if(list.length!==1||!wire.includes(list[0].wire))throw Error('format');return list[0].value;
}
export function decodeGrokCredits(input){
  const raw=input?.bytes;
  if(!Array.isArray(raw)||!raw.length||raw.length>MAX||raw.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error('format');
  const bytes=Uint8Array.from(raw);let at=0,payload=null,status=input.status??null,trailers=false;
  while(at<bytes.length){
    if(bytes.length-at<5)throw Error('format');
    const flag=bytes[at],length=new DataView(bytes.buffer,at+1,4).getUint32(0,false);at+=5;
    if(length>bytes.length-at||![0,128].includes(flag))throw Error('format');
    const part=bytes.subarray(at,at+length);at+=length;
    if(flag===128){
      if(trailers||at!==bytes.length)throw Error('format');trailers=true;
      const text=new TextDecoder().decode(part),matches=[...text.matchAll(/^grpc-status\s*:\s*(\d+)\s*$/gim)];
      if(matches.length!==1||status!==null&&String(status)!==matches[0][1])throw Error('format');status=matches[0][1];
    }else{if(payload||trailers)throw Error('format');payload=part;}
  }
  // Some native responses omit trailers; never ignore a reported RPC error.
  if(status!==null&&String(status)!=='0')throw Error(String(status)==='16'?'auth':String(status)==='8'?'rate':'network');
  if(!payload)throw Error('format');
  const root=fields(payload),configBytes=one(root,1,[2]);if(!configBytes)throw Error('format');
  const config=fields(configBytes),usedRaw=one(config,1,[5]),period=one(config,5,[2]);let resetAt=null;
  if(period){const timestamp=fields(period),seconds=one(timestamp,1,[0]),nanos=one(timestamp,2,[0]);
    if(seconds!==undefined&&seconds>0&&seconds<253402300800&&(nanos===undefined||nanos<1000000000))resetAt=seconds*1000+Math.floor((nanos||0)/1000000);else throw Error('format');}
  const labels={2:'Grok Build',4:'Chat',5:'Imagine',6:'Voice'},products=[];
  for(const field of config.get(7)||[]){
    if(field.wire!==2)throw Error('format');const product=fields(field.value),id=one(product,1,[0]),percent=one(product,2,[5]);
    if(!Number.isInteger(id)||percent!==undefined&&(!Number.isFinite(percent)||percent<0||percent>100))throw Error('format');
    if(products.some(p=>p.id===id))throw Error('format');products.push({id,label:labels[id]||'Other product '+id,percent:percent??0});
  }
  // proto3 can omit a zero float, but require another recognizable field.
  if(usedRaw===undefined&&resetAt===null&&!products.length)throw Error('format');
  const used=usedRaw??0;if(!Number.isFinite(used)||used<0||used>100)throw Error('format');
  return {used,resetAt,products};
}
export function parseGrokFree(data,now=Date.now()){
  const total=data?.totalQueries,remaining=data?.remainingQueries,seconds=data?.windowSizeSeconds;
  if(!Number.isSafeInteger(total)||total<=0||!Number.isSafeInteger(remaining)||remaining<0||remaining>total||!Number.isSafeInteger(seconds)||seconds<=0)throw Error('format');
  return {windows:[{id:'fast',label:'Fast · '+C.windowLabel(seconds),used:(total-remaining)/total*100,remaining,total,seconds,resetAt:null,main:true}],models:[],resets:null,credits:null,reached:remaining===0,fetchedAt:now,source:'Grok REST'};
}
export async function loadGrok(context,request,session,now=Date.now){
  const before=await session();if(!before)throw Error('auth');if(context.sessionHash!==before)throw Error('context');
  const subscriptions=await request('subscriptions');
  if(!Array.isArray(subscriptions?.subscriptions)||subscriptions.subscriptions.some(s=>!s||typeof s.status!=='string'))throw Error('format');
  const paid=subscriptions.subscriptions.some(s=>s.status==='SUBSCRIPTION_STATUS_ACTIVE');
  let usage;
  if(paid){
    const pool=decodeGrokCredits(await request('paid'));
    usage={windows:[{id:'shared_pool',label:'Weekly usage pool',used:pool.used,seconds:604800,resetAt:pool.resetAt,main:true}],products:pool.products,models:[],resets:null,credits:null,reached:pool.used>=100,fetchedAt:now(),source:'Grok gRPC-Web',notice:'Paid Grok support is experimental; live paid accounts have not been tested.'};
  }else usage=parseGrokFree(await request('free'),now());
  if(await session()!==before)throw Error('context');
  const key=await fingerprint('grok/account/'+before),plan=paid?'paid':'free';
  return {key,plan,label:`${paid?'PAID':'FREE'} · ${key.slice(-4)}`,usage,init:null,errors:[],diagnostics:{tier:plan,paidLiveTested:false,resetReported:Boolean(usage.windows[0].resetAt)}};
}

import './shared.js';
import {fingerprint,loadBundle} from './api.mjs';
import {scrapeGemini} from './gemini-dom.mjs';
import {readClaudeStream} from './claude-live.mjs';
import {discoverGemini} from './gemini-discovery.mjs';
import {requestGeminiJSON} from './gemini-http.mjs';
const C=globalThis.LimitsCore;
export function geminiPaths(index=0,captured=null){
  const prefix=index?`/u/${index}`:'';
  const app=prefix+'/app?authuser='+index;
  if(!captured?.signature||captured.signature.length>256||!/^[A-Za-z0-9+/_=\-]+$/.test(captured.signature))return {app,usage:null};
  const variables=captured.variables||{g1Request:{entrypoints:['GEMINI_USAGE_SETTINGS_UPGRADE_BANNER']},workspaceRequest:{recommendationsForSurfaceRequests:[]}};
  const query=new URLSearchParams({query_signature:captured.signature,variables:JSON.stringify(variables),authuser:String(index)});
  // Keep the native request's path family; some deployments use authuser with
  // a root RPC path, others include /u/N. Routing is always rebuilt for this seat.
  return {app,usage:(captured.scoped===false?'':prefix)+'/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery?'+query};
}
// Runs in the isolated world of an existing tab. No cookies, tokens, bootstrap
// HTML or conversation content are returned to the extension from this bridge.
export async function requestInTab(spec){
  try{
    const host={claude:'claude.ai',gemini:'gemini.google.com'}[spec.provider];
    if(location.hostname!==host)throw new Error('context');
    const path=new URL(spec.path,location.origin);
    const allowed=spec.provider==='claude'?/^\/api\/organizations(?:\/[a-z0-9-]+\/usage)?$/i.test(path.pathname):/^\/(?:u\/\d+\/)?(?:app|_\/BardChatUi\/graphql\/schemas\/GEMINI_WEB_GRAPHQL\/executeQuery)$/.test(path.pathname);
    if(path.origin!==location.origin||!allowed)throw new Error('context');
    const headers={Accept:spec.kind==='bootstrap'?'text/html':'application/json'};
    if(spec.provider==='gemini')headers['X-Goog-AuthUser']=String(spec.accountIndex||0);
    const response=await fetch(path.href,{credentials:'include',cache:'no-store',redirect:spec.kind==='bootstrap'||spec.provider==='gemini'?'follow':'error',headers,signal:AbortSignal.timeout(12000)});
    if(response.url&&new URL(response.url).origin!==location.origin)return {ok:false,error:'auth',detail:'Redirected to sign-in'};
    if(spec.provider==='gemini'&&spec.kind!=='bootstrap'&&response.url){
      const final=new URL(response.url),route=final.pathname.match(/^\/(?:u\/(\d+)\/)?_\/BardChatUi\/graphql\/schemas\/GEMINI_WEB_GRAPHQL\/executeQuery$/);
      const index=spec.accountIndex||0,routed=[route?.[1],final.searchParams.get('authuser')].filter(v=>v!=null);
      if(!route||(routed.length?routed.some(v=>!/^\d{1,3}$/.test(v)||Number(v)!==index):index!==0)||['query_signature','variables'].some(k=>final.searchParams.get(k)!==path.searchParams.get(k)))return {ok:false,error:'context',detail:'Usage redirect changed request or Google account'};
    }
    if(!response.ok)return {ok:false,error:response.status===401||response.status===403?'auth':response.status===429?'rate':'network',detail:'HTTP '+response.status};
    const text=await response.text();
    if(spec.kind==='bootstrap'){
      const found=text.match(/"oPEP7c"\s*:\s*("(?:[^"\\]|\\.)*")/);let email='';
      try{email=JSON.parse(found?.[1]||'null')?.trim().toLowerCase()||'';}catch{}
      if(!email.includes('@'))throw new Error('auth');
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('gemini/'+(spec.accountIndex||0)+'/'+email));
      return {ok:true,data:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('').slice(0,24)};
    }
    if(text.trimStart().startsWith('<'))throw new Error('auth');
    if(spec.provider==='gemini')return {ok:true,data:text};
    try{return {ok:true,data:JSON.parse(text)};}catch{throw new Error('format');}
  }catch(e){return {ok:false,error:['auth','context','rate','format'].includes(e.message)?e.message:'network',detail:['TypeError','TimeoutError','AbortError'].includes(e.name)?e.name:'Request or parsing failed'};}
}
export async function tabRequest(tabId,spec){
  const stage=spec.kind==='bootstrap'?'Gemini bootstrap':spec.provider==='gemini'?'Gemini GraphQL':spec.path==='/api/organizations'?'Claude organizations':'Claude usage';
  let results;
  try{results=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:requestInTab,args:[spec]});}
  catch{const e=new Error('network');e.detail='Browser could not execute request';e.stage=stage;e.diagnostics={attempts:[{stage,detail:e.detail}]};throw e;}
  let result=results.find(v=>v.frameId===0)?.result;
  if(spec.provider==='gemini'&&spec.kind!=='bootstrap'&&result?.error==='network')result=await requestGeminiJSON(spec);
  if(!result?.ok){const e=new Error(result?.error||'network');e.detail=result?.detail||'Empty script result';e.stage=stage;e.diagnostics={attempts:[{stage,detail:e.detail}]};throw e;}
  return result.data;
}
export async function loadClaude(context,request,session,now=Date.now,stream=null){
  // Include the HttpOnly session fingerprint: two seats in the same org must
  // never share a last-good snapshot after a logout/login.
  const before=await session();if(!before)throw new Error('auth');
  if(context.sessionHash&&context.sessionHash!==before)throw new Error('context');
  const orgs=await request({provider:'claude',path:'/api/organizations'});
  if(!Array.isArray(orgs))throw new Error('format');
  const chat=orgs.filter(v=>typeof v?.uuid==='string'&&/^[a-z0-9-]{8,80}$/i.test(v.uuid)&&v.capabilities?.includes('chat'));
  const org=context.org?chat.find(v=>v.uuid===context.org):chat.length===1?chat[0]:null;
  if(!org)throw new Error('context');
  const data=await request({provider:'claude',path:`/api/organizations/${org.uuid}/usage`});
  if(await session()!==before)throw new Error('context');
  const shape=Object.fromEntries(['five_hour','seven_day'].map(k=>[k,data?.[k]==null?'null':typeof data[k]]));shape.limits=Array.isArray(data?.limits)?data.limits.length:'absent';
  let usage;try{usage=C.parseClaude(data,now());}catch(e){e.diagnostics={shape};throw e;}
  const live=stream?await stream(org.uuid):null;
  if(live?.windows?.length){
    const merged=new Map(usage.windows.map(w=>[w.id,w]));
    for(const w of live.windows)if(!w.resetAt||w.resetAt>now())merged.set(w.id,{...w,observation:'event'});
    usage={...usage,windows:[...merged.values()],observation:'event',source:usage.windows.length?'Claude REST + live event':'Claude live event',fetchedAt:live.fetchedAt,unavailable:null};
  }
  if(await session()!==before)throw new Error('context');
  const key=await fingerprint('claude/'+before+'/'+org.uuid);
  const caps=org.capabilities||[];
  const plan=caps.includes('claude_max')?'max':caps.includes('claude_pro')?'pro':null;
  return {key,plan,label:`${plan?C.planLabel(plan):'CLAUDE'} · ${key.slice(-4)}`,usage,init:null,errors:[],diagnostics:{shape,selectedBy:context.org?'active-org-cookie':'only-chat-org',chatOrganizations:chat.length}};
}
export async function loadGemini(context,request,now=Date.now,dom=null,options={}){
  const spec={provider:'gemini',accountIndex:context.accountIndex};
  const state={...(options.providerState||{})},attempts=[];let usage,triedJSON=false,discovered=false;
  const canDiscover=options.discover&&(!state.discoveryRetryAt||now()>=state.discoveryRetryAt||options.force);
  const note=error=>{if(error.stage==='Gemini descriptor discovery')attempts.push(...error.diagnostics?.attempts||[]);attempts.push({stage:error.stage||'Gemini JSON',error:error.message,detail:error.detail||error.message});};
  const stop=error=>{error.diagnostics={attempts};error.providerState=state;throw error;};
  async function discover(){
    discovered=true;
    try{
      const query=await options.discover();if(!geminiPaths(context.accountIndex,query).usage)throw new Error('format');
      state.geminiQuery=query;state.jsonRetryAt=0;state.discoveryRetryAt=0;
      attempts.push({stage:'Gemini Relay descriptor',detail:'UsagePageQuery descriptor read from a public asset'});return true;
    }catch(e){state.discoveryRetryAt=now()+30*60000;note(e);if(['context','rate'].includes(e.message))stop(e);return false;}
  }
  if(!geminiPaths(context.accountIndex,state.geminiQuery).usage&&canDiscover)await discover();
  let paths=geminiPaths(context.accountIndex,state.geminiQuery);
  const jsonAllowed=Boolean(paths.usage)&&(!state.jsonRetryAt||now()>=state.jsonRetryAt);
  if(!jsonAllowed&&state.domRetryAt>now()&&!options.force&&options.previousUsage&&now()-options.previousUsage.fetchedAt<10*60000)return {deferred:true,providerState:state};
  async function readJSON(){
    triedJSON=true;
    const before=await request({...spec,path:paths.app,kind:'bootstrap'});
    if(before!==context.hint)throw new Error('context');
    const data=await request({...spec,path:paths.usage});
    if(await request({...spec,path:paths.app,kind:'bootstrap'})!==before)throw new Error('context');
    const reading={...C.parseGemini(data,now()),source:'Gemini GraphQL'};
    if(!reading.windows.length)throw new Error('format');
    state.jsonRetryAt=0;state.domRetryAt=0;return reading;
  }
  try{
    if(!jsonAllowed){const e=new Error('format');e.stage=paths.usage?'Gemini JSON cooldown':'Gemini request discovery';e.detail=paths.usage?'Using native Usage source after previous JSON failure':'No verified usage request descriptor';throw e;}
    usage=await readJSON();
  }catch(error){
    note(error);if(['context','rate'].includes(error.message))stop(error);
    // A rejected captured descriptor may be replaced by current public client
    // metadata. Retry the JSON once, before opening the native Usage document.
    if(triedJSON&&canDiscover&&!discovered&&await discover()){
      paths=geminiPaths(context.accountIndex,state.geminiQuery);
      try{usage=await readJSON();}catch(e){error=e;note(e);if(['context','rate'].includes(e.message))stop(e);}
    }
    if(!usage){
      if(!dom)stop(error);
      if(triedJSON){state.jsonRetryAt=now()+30*60000;state.geminiQuery=null;}
      try{
        const data=await dom({fresh:triedJSON});
        const at=data.observedAt||now();
        if(data.graphql){
          usage={...C.parseGemini(data.graphql,at),source:'Gemini captured GraphQL'};
          if(!usage.windows.length)throw new Error('format');
          if(geminiPaths(context.accountIndex,data.query).usage){state.geminiQuery=data.query;state.jsonRetryAt=0;}
        }else{
          const windows=data.windows.map(w=>w.resetAt?w:{...w,resetAt:C.parseResetText(w.resetText,at),resetFromText:true});
          usage={windows,plan:data.plan,models:[],resets:null,credits:null,reached:windows.some(w=>w.used>=100),fetchedAt:at,source:'Gemini Usage page'};
        }
        state.domRetryAt=now()+10*60000;
        attempts.push({stage:data.graphql?'Gemini native network':'Gemini Usage page',detail:data.graphql?'Usage JSON and request signature captured in verified account':'Two numeric bars verified'});
      }catch(e){state.domRetryAt=now()+60000;attempts.push({stage:'Gemini Usage page',error:e.message,detail:e.detail||e.message});stop(e);}
    }
  }
  const key=await fingerprint('gemini/'+context.hint);
  return {key,plan:usage.plan,label:`${usage.plan?C.planLabel(usage.plan):'GEMINI'} · ${key.slice(-4)}`,usage,init:null,errors:[],diagnostics:{attempts},providerState:state};
}
export async function loadProvider(context,tabId,options){
  if(context.provider==='chatgpt')return loadBundle(undefined,undefined,options);
  const request=spec=>tabRequest(tabId,spec);
  if(context.provider==='gemini')return loadGemini(context,request,Date.now,probeOptions=>scrapeGemini(tabId,context,probeOptions),{...options,discover:()=>discoverGemini(tabId,context)});
  if(context.provider==='claude')return loadClaude(context,request,async()=>{
    const cookie=await chrome.cookies.get({url:'https://claude.ai/',name:'sessionKey'});
    return cookie?.value?fingerprint(cookie.value):null;
  },Date.now,org=>readClaudeStream(tabId,context,org).catch(()=>null));
  throw new Error('context');
}

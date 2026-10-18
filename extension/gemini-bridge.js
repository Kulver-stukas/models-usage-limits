/* Runs before Gemini's own scripts in each matching frame. Observe only the
 * usage GraphQL response; never forward request headers or arbitrary JSON. */
(() => {
  if(location.hostname!=='gemini.google.com')return;
  const version='0.3.3',old=globalThis.__usageMeterGeminiBridge;
  if(old?.version===version&&old.touch())return;old?.dispose?.();
  const originalFetch=window.fetch,proto=window.XMLHttpRequest?.prototype;
  const originalOpen=proto?.open,originalSend=proto?.send,requests=new WeakMap();
  let latest=null,disposed=false,expires=Date.now()+10*60000;
  const status={matched:0,http:null,result:'waiting'};
  const index=()=>Number(location.pathname.match(/^\/u\/(\d+)(?:\/|$)/)?.[1]??new URL(location.href).searchParams.get('authuser')??0);
  async function identity(){
    const accountIndex=index();if(!Number.isInteger(accountIndex)||accountIndex<0||accountIndex>999)return null;
    for(const script of document.scripts){
      const found=script.textContent.match(/"oPEP7c"\s*:\s*("(?:[^"\\]|\\.)*")/);if(!found)continue;
      let email;try{email=JSON.parse(found[1]).trim().toLowerCase();}catch{return null;}
      if(!email.includes('@'))return null;
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('gemini/'+accountIndex+'/'+email));
      return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('').slice(0,24);
    }
    return null;
  }
  function descriptor(raw,method){
    try{
      if(disposed||Date.now()>expires||String(method||'GET').toUpperCase()!=='GET')return null;
      const u=new URL(raw,location.href),path=u.pathname.match(/^\/(?:u\/(\d+)\/)?_\/BardChatUi\/graphql\/schemas\/GEMINI_WEB_GRAPHQL\/executeQuery$/);
      if(u.origin!==location.origin||!path)return null;
      const routed=[path[1],u.searchParams.get('authuser')].filter(v=>v!=null);
      if(routed.some(v=>!/^\d{1,3}$/.test(v)||Number(v)!==index()))return null;
      const signature=u.searchParams.get('query_signature');
      if(!signature||signature.length>256||!/^[A-Za-z0-9+/_=\-]+$/.test(signature))return null;
      // Persist only known non-user-specific variables, with account routing
      // rebuilt at replay time. Never cache the complete URL or headers.
      let variables=null;const rawVariables=u.searchParams.get('variables');
      if(rawVariables&&rawVariables.length<=4096){
        const v=JSON.parse(rawVariables),keys=Object.keys(v||{});
        if(keys.every(k=>['g1Request','workspaceRequest'].includes(k))&&keys.length){
          const clean={};
          if(v.g1Request&&Object.keys(v.g1Request).every(k=>k==='entrypoints')&&Array.isArray(v.g1Request.entrypoints)&&v.g1Request.entrypoints.every(x=>typeof x==='string'&&/^[A-Z0-9_]{1,100}$/.test(x)))clean.g1Request={entrypoints:v.g1Request.entrypoints.slice(0,16)};
          if(v.workspaceRequest&&Object.keys(v.workspaceRequest).every(k=>k==='recommendationsForSurfaceRequests')&&Array.isArray(v.workspaceRequest.recommendationsForSurfaceRequests)&&!v.workspaceRequest.recommendationsForSurfaceRequests.length)clean.workspaceRequest={recommendationsForSurfaceRequests:[]};
          if(Object.keys(clean).length===keys.length)variables=clean;
        }
      }
      return {signature,scoped:Boolean(path[1]),variables};
    }catch{return null;}
  }
  function findInfo(node,depth=0){
    if(!node||typeof node!=='object'||depth>8)return null;
    if(Array.isArray(node.pools)&&node.pools.some(p=>['GXU_FIVE_HOURLY','GXU_WEEKLY'].includes(p?.poolType)))return node;
    for(const value of Object.values(node)){const found=findInfo(value,depth+1);if(found)return found;}
    return null;
  }
  async function capture(text,query,before,started){
    if(disposed||Date.now()>expires||text.length>2*1024*1024)return;
    try{
      const expected=await before;if(!expected||await identity()!==expected){status.result='identity';return;}
      const root=JSON.parse(text.trim().replace(/^\)\]}'\s*/,'')),info=findInfo(root);
      if(!info){status.result='no-usage-pools';return;}
      const pools=info.pools.filter(p=>['GXU_FIVE_HOURLY','GXU_WEEKLY'].includes(p?.poolType)).map(p=>{const reset=p.gxu?.windowRefreshesAt||p.windowRefreshesAt;return {poolType:p.poolType,percentageUsed:p.percentageUsed,gxu:{windowRefreshesAt:typeof reset==='string'&&reset.length<=64?reset:null}};});
      // The observed schema uses fractions. Reject a changed unit instead of
      // interpreting 1 as either 1% or 100% depending on other values.
      if(!pools.length||pools.some(p=>typeof p.percentageUsed!=='number'||!Number.isFinite(p.percentageUsed)||p.percentageUsed<0||p.percentageUsed>1)){status.result='format';return;}
      if(latest&&latest.started>started)return;
      latest={hint:expected,started,observedAt:Date.now(),query,graphql:{pools,subscriptionTier:['TIER1','TIER2'].includes(info.subscriptionTier)?info.subscriptionTier:null}};
      status.result='captured';
    }catch{status.result='format';}
  }
  async function wrappedFetch(input,init){
    let query=null;try{query=descriptor(typeof input==='string'||input instanceof URL?String(input):input?.url,init?.method||input?.method);}catch{}
    if(query)status.matched++;
    const before=query?identity():null,started=Date.now();
    let response;try{response=await originalFetch.apply(this,arguments);}catch(e){if(query)status.result='network';throw e;}
    if(query){status.http=response.status;if(!response.ok)status.result='http';}
    if(query&&response.ok)try{void response.clone().text().then(text=>capture(text,query,before,started)).catch(()=>{});}catch{}
    return response;
  }
  function wrappedOpen(method,url){requests.delete(this);const query=descriptor(String(url),method);if(query)requests.set(this,{query});return originalOpen.apply(this,arguments);}
  function wrappedSend(){
    const request=requests.get(this);
    if(request){status.matched++;const before=identity(),started=Date.now();this.addEventListener('load',()=>{
      if(requests.get(this)!==request)return;
      status.http=this.status;if(this.status<200||this.status>=300){status.result='http';return;}
      try{const text=this.responseType==='json'?JSON.stringify(this.response):!this.responseType||this.responseType==='text'?this.responseText:null;if(typeof text==='string')void capture(text,request.query,before,started);}catch{}
    },{once:true});}
    return originalSend.apply(this,arguments);
  }
  window.fetch=wrappedFetch;if(proto){proto.open=wrappedOpen;proto.send=wrappedSend;}
  function dispose(){disposed=true;latest=null;clearInterval(timer);if(window.fetch===wrappedFetch)window.fetch=originalFetch;if(proto?.open===wrappedOpen)proto.open=originalOpen;if(proto?.send===wrappedSend)proto.send=originalSend;}
  const timer=setInterval(()=>{if(Date.now()>expires)dispose();},60000);
  globalThis.__usageMeterGeminiBridge={version,touch(){if(disposed)return false;expires=Date.now()+10*60000;return true;},dispose,status:()=>({...status,active:!disposed}),
    async read(hint){if(disposed)return null;expires=Date.now()+10*60000;const current=await identity();if(!current||current!==hint||latest?.hint!==hint)return null;return JSON.parse(JSON.stringify(latest));}};
})();

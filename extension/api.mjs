import './shared.js';
const Core=globalThis.LimitsCore;
export async function fingerprint(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('').slice(0,24);
}
export async function loadBundle(fetchFn=fetch,now=Date.now,{skipFeatures=false}={}) {
  async function json(path,options={}) {
    const res=await fetchFn('https://chatgpt.com'+path,{...options,credentials:'include',cache:'no-store',
      redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!res.ok)throw new Error(res.status===401||res.status===403?'auth':res.status===429?'rate':'network');
    try{return await res.json();}catch{throw new Error('format');}
  }
  function identity(s) {
    if(!s?.accessToken)throw new Error('auth');
    if(!s.account?.id || !s.user?.id)throw new Error('context');
    return `${s.user.id}/${s.account.id}/${s.account.structure || ''}`;
  }
  const session=await json('/api/auth/session');
  const id=identity(session),account=session.account;
  const headers={Authorization:`Bearer ${session.accessToken}`,Accept:'application/json'};
  if(account.structure && account.structure!=='personal')headers['chatgpt-account-id']=account.id;
  const results=await Promise.allSettled([
    json('/backend-api/wham/usage',{headers}),
    skipFeatures?Promise.resolve(null):json('/backend-api/conversation/init',{method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({gizmo_id:null,requested_default_model:null,conversation_id:null,timezone_offset_min:new Date().getTimezoneOffset()})}),
  ]);
  // A response from a previous login/workspace must not enter the current cache.
  const after=await json('/api/auth/session');
  if(identity(after)!==id)throw new Error('context');
  const fetched=now();let usage=null,init=null;const errors=[];
  for(const [index,r] of results.entries()) {
    if(index===1 && skipFeatures)continue;
    const source=index===0?'usage':'features';
    if(r.status==='rejected'){errors.push(`${source}: ${['auth','rate','format'].includes(r.reason?.message)?r.reason.message:'network'}`);continue;}
    try {
      if(index===0){
        if(r.value.account_id && r.value.account_id!==account.id)throw new Error('context');
        if(r.value.user_id && r.value.user_id!==session.user.id)throw new Error('context');
        usage=Core.parseUsage(r.value,fetched);
      } else init=Core.parseInit(r.value,fetched);
    } catch(e){if(e.message==='context')throw e;errors.push(`${source}: format`);}
  }
  const key=await fingerprint(id);
  return {key,plan:usage?.plan || account.planType || '',label:`${Core.planLabel(usage?.plan || account.planType)} · ${key.slice(-4)}`,usage,init,initSkipped:skipFeatures,errors};
}

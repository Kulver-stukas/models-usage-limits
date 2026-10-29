/* Original implementation. This file is shared by the worker, popup and page. */
(() => {
  const VERSION = '0.3.7';
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const clamp = n => Math.min(100, Math.max(0, n));
  const plans = {team:'BUSINESS',business:'BUSINESS',free:'FREE',plus:'PLUS',pro:'PRO',go:'GO',enterprise:'ENTERPRISE',edu:'EDU'};
  const features = {reason:'Thinking',deep_research:'Deep research',image_gen:'Image generation',file_upload:'File uploads',paste_text_to_file:'Long text pastes',agent:'Agent mode',agent_mode:'Agent mode',video_gen:'Video generation'};
  function windowLabel(seconds) {
    if (seconds === 604800) return 'Weekly limit';
    if (seconds === 86400) return 'Daily limit';
    if (seconds > 0 && seconds % 86400 === 0) return `${seconds / 86400}-day limit`;
    if (seconds > 0 && seconds % 3600 === 0) return `${seconds / 3600}-hour limit`;
    if (seconds > 0) return `${Math.round(seconds / 60)}-minute limit`;
    return 'Usage limit';
  }
  function resetAt(w, now) {
    if (finite(w.reset_at) && w.reset_at > 0) return w.reset_at * 1000;
    if (finite(w.reset_after_seconds)) return now + Math.max(0,w.reset_after_seconds)*1000;
    return null;
  }
  function parseUsage(data, now) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('format');
    const windows = [];
    function add(limit, scope, key) {
      if (!limit) return;
      for (const [slot, w] of Object.entries({primary:limit.primary_window,secondary:limit.secondary_window})) {
        if (!w || !finite(w.used_percent)) continue;
        const seconds = finite(w.limit_window_seconds) ? w.limit_window_seconds : 0;
        windows.push({id:`${key}:${slot}`, label:(scope ? `${scope} · ` : '')+windowLabel(seconds),
          seconds, used:clamp(w.used_percent), resetAt:resetAt(w,now), main:key==='main'});
      }
    }
    add(data.rate_limit,'','main');
    if(data.rate_limit && typeof data.rate_limit==='object' && !windows.length)throw new Error('format');
    add(data.code_review_rate_limit,'Code review','review');
    for (const [i, item] of (Array.isArray(data.additional_rate_limits)?data.additional_rate_limits:[]).entries()) {
      add(item?.rate_limit, String(item?.limit_name || item?.metered_feature || 'Additional'),`extra${i}`);
    }
    if (!('rate_limit' in data) && !('model_usage' in data)) throw new Error('format');
    const models = Object.entries(data.model_usage || {}).filter(([,v])=>v && typeof v.available==='boolean').map(([name,v])=>({
      name, available:v.available, availableAt:finite(v.available_at)?v.available_at*1000:null,
      creditsWouldEnable:v.credits_would_enable===true,
    }));
    const r=data.rate_limit_reset_credits;
    return {plan:typeof data.plan_type==='string'?data.plan_type:null,windows,models,
      reached:data.rate_limit?.limit_reached===true,allowed:data.rate_limit?.allowed,
      resets:r && finite(r.available_count)?{available:r.available_count,applicable:finite(r.applicable_available_count)?r.applicable_available_count:null}:null,
      credits:data.credits?{hasCredits:data.credits.has_credits===true,unlimited:data.credits.unlimited===true,
        balance:typeof data.credits.balance==='string'||finite(data.credits.balance)?data.credits.balance:null}:null,
      fetchedAt:now};
  }
  function parseInit(data, now) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.limits_progress)) throw new Error('format');
    return {features:data.limits_progress.filter(v=>v && typeof v.feature_name==='string' && finite(v.remaining)).map(v=>({
      id:v.feature_name,label:features[v.feature_name] || v.feature_name.replace(/[_-]/g,' '),
      remaining:Math.max(0,Math.floor(v.remaining)),resetAt:Number.isFinite(Date.parse(v.reset_after))?Date.parse(v.reset_after):null,
    })),maxFileMB:finite(data.file_attachment_limits?.max_size_mb)?data.file_attachment_limits.max_size_mb:null,
      modelLimitCount:Array.isArray(data.model_limits)?data.model_limits.length:0,fetchedAt:now};
  }
  const percent = (used,mode) => mode==='used'?Math.round(clamp(used)):100-Math.round(clamp(used));
  const color = used => used>=85?'#d74444':used>=70?'#c48512':'#269b78';
  const usageTone = used => !finite(used)?'normal':used>=90?'critical':used>=70?'warning':'normal';
  function usageBarColor(used){
    if(!finite(used))return '#737b85';
    const value=clamp(used),start=value<70?[38,155,120]:[214,160,44],end=value<70?[214,160,44]:[220,69,73];
    const t=value<70?value/70:Math.min(1,(value-70)/20);
    return '#'+start.map((v,i)=>Math.round(v+(end[i]-v)*t).toString(16).padStart(2,'0')).join('');
  }
  function countTone(remaining,reference){
    if(!finite(remaining)||remaining<0)return 'normal';
    if(remaining===0)return 'critical';
    if(!finite(reference)||reference<=0)return 'normal';
    const used=Math.max(0,reference-remaining);
    if(used>=Math.max(1,Math.floor(reference*.9)))return 'critical';
    if(used>=Math.max(1,Math.floor(reference*.7)))return 'warning';
    return 'normal';
  }
  const planLabel = p => plans[p] || String(p || 'ACCOUNT').toUpperCase();
  function countdown(at, now=Date.now()) {
    if (!finite(at)) return 'Reset time unavailable';
    const mins=Math.ceil((at-now)/60000);
    if (mins<=0) return 'Reset due · awaiting update';
    if (mins>=1440) return `Resets in ${Math.floor(mins/1440)}d ${Math.floor(mins%1440/60)}h`;
    return mins>=60?`Resets in ${Math.floor(mins/60)}h ${mins%60}m`:`Resets in ${mins}m`;
  }
  const providers={chatgpt:{name:'ChatGPT',home:'https://chatgpt.com/',usage:'https://chatgpt.com/settings/usage?tab=overview'},claude:{name:'Claude',home:'https://claude.ai/new',usage:'https://claude.ai/settings/usage'},grok:{name:'Grok',home:'https://grok.com/',usage:'https://grok.com/'},gemini:{name:'Gemini',home:'https://gemini.google.com/app',usage:'https://gemini.google.com/usage'}};
  function providerForURL(value){
    try{
      const u=new URL(value);if(u.protocol!=='https:')return null;
      const p={'chatgpt.com':'chatgpt','claude.ai':'claude','gemini.google.com':'gemini','grok.com':'grok'}[u.hostname];
      if(!p||/^\/(api|backend-api|rest|grok_api_v2\.GrokBuildBilling|_|auth|login|logout|share|admin|public)(\/|$)/.test(u.pathname))return null;
      return p;
    }catch{return null;}
  }
  // Self-contained: also used by scripting.executeScript before content.js exists.
  // Only bootstrap identity and account cookies are inspected, never chat text.
  async function readPageContext(){
    const host=location.hostname,provider={'chatgpt.com':'chatgpt','claude.ai':'claude','gemini.google.com':'gemini','grok.com':'grok'}[host];
    if(!provider)return null;
    const cookie=name=>{const v=document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));try{return v?decodeURIComponent(v.slice(name.length+1)):'';}catch{return '';}};
    let identity='',org=null,accountIndex=0;
    if(provider==='grok')identity='session';
    if(provider==='chatgpt')identity=cookie('_account')||'profile';
    if(provider==='claude'){
      org=cookie('lastActiveOrg');if(!/^[a-z0-9-]{8,80}$/i.test(org))org=null;
      identity=org||'discover';
    }
    if(provider==='gemini'){
      const u=new URL(location.href),index=u.pathname.match(/^\/u\/(\d+)(?:\/|$)/)?.[1] ?? u.searchParams.get('authuser') ?? '0';
      if(!/^\d{1,3}$/.test(index))return {provider,error:'context'};
      accountIndex=Number(index);
      for(const script of document.scripts){
        const raw=script.textContent;if(!raw.includes('oPEP7c'))continue;
        const found=raw.match(/"oPEP7c"\s*:\s*("(?:[^"\\]|\\.)*")/);
        if(found){try{identity=JSON.parse(found[1]).trim().toLowerCase();}catch{}break;}
      }
      if(!identity||!identity.includes('@'))return {provider,error:'context'};
      identity=accountIndex+'/'+identity;
    }
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(provider+'/'+identity));
    const hint=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('').slice(0,24);
    return {provider,hint,scope:provider==='chatgpt'?'chatgpt':provider+':'+hint,org,accountIndex};
  }
  function parseClaude(data,now){
    if(!data||typeof data!=='object'||Array.isArray(data)||!(['five_hour','seven_day'].some(k=>k in data)||Array.isArray(data.limits)))throw new Error('format');
    const windows=[];
    const labels={five_hour:'5-hour limit',seven_day:'Weekly limit',seven_day_opus:'Opus · Weekly limit',seven_day_sonnet:'Sonnet · Weekly limit',seven_day_oauth_apps:'OAuth apps · Weekly limit',seven_day_cowork:'Cowork · Weekly limit'};
    for(const [key,v] of Object.entries(data)){
      if(!v||key==='extra_usage')continue;
      if(!finite(v.utilization)){if(v.utilization!=null&&(key==='five_hour'||key==='seven_day'))throw new Error('format');continue;}
      if(v.utilization<0)throw new Error('format');
      windows.push({id:key,label:labels[key]||key.replace(/_/g,' '),observation:'rest',used:clamp(v.utilization),seconds:key==='five_hour'?18000:key.startsWith('seven_day')?604800:0,resetAt:Number.isFinite(Date.parse(v.resets_at))?Date.parse(v.resets_at):null,main:key==='five_hour'||key==='seven_day'});
    }
    // Current schema: authoritative named windows may be in limits[]. A
    // partially deployed array must not remove healthy legacy main windows.
    for(const [index,item] of (Array.isArray(data.limits)?data.limits:[]).entries()){
      if(!item||!['session','weekly_all','weekly_scoped'].includes(item.kind)||!finite(item.percent)||item.percent<0)continue;
      const kind=item.kind,id=kind==='session'?'five_hour':kind==='weekly_all'?'seven_day':'scoped:'+index;
      const label=kind==='session'?'5-hour limit':kind==='weekly_all'?'Weekly limit':`${String(item.scope?.model?.display_name||'Model').slice(0,64)} · Weekly limit`;
      const window={id,label,observation:'rest',used:clamp(item.percent),seconds:kind==='session'?18000:604800,resetAt:Number.isFinite(Date.parse(item.resets_at))?Date.parse(item.resets_at):null,main:kind==='session'||kind==='weekly_all'};
      const previous=windows.findIndex(w=>w.id===id);if(previous>=0)windows[previous]=window;else windows.push(window);
    }
    const extra=data.extra_usage;
    if(extra?.is_enabled===true&&finite(extra.utilization))windows.push({id:'extra_usage',label:'Extra usage',used:clamp(extra.utilization),seconds:0,resetAt:null,main:false});
    return {windows,models:[],resets:null,credits:null,reached:windows.some(w=>w.main&&w.used>=100),fetchedAt:now,source:'Claude REST',unavailable:windows.length?null:'The API returned no numeric usage. Waiting for a usage event from a normal chat reply.'};
  }
  function parseGemini(text,now){
    let results;try{results=typeof text==='string'?JSON.parse(text.trim().replace(/^\)\]}'\s*/,'')):text;}catch{throw new Error('format');}
    const root=Array.isArray(results)?results:[results];
    const envelope=root.find(v=>v?.data&&Object.hasOwn(v.data,'viewer'));
    if(envelope?.data.viewer===null)throw new Error('auth');
    function findInfo(node,depth=0){
      if(!node||typeof node!=='object'||depth>8)return null;
      if(Array.isArray(node.pools)&&node.pools.some(p=>['GXU_FIVE_HOURLY','GXU_WEEKLY'].includes(p?.poolType)))return node;
      for(const value of Object.values(node)){const found=findInfo(value,depth+1);if(found)return found;}
      return null;
    }
    const data=envelope?.data?.viewer?.rpcs?.getUsageInfo||findInfo(root);
    if(!Array.isArray(data?.pools))throw new Error('format');
    const windows=[];
    for(const [type,seconds] of [['GXU_FIVE_HOURLY',18000],['GXU_WEEKLY',604800]]){
      const pool=data.pools.find(v=>v?.poolType===type);if(!pool)continue;
      if(!finite(pool.percentageUsed)||pool.percentageUsed<0||pool.percentageUsed>1)throw new Error('format');
      const at=Date.parse(pool.gxu?.windowRefreshesAt||pool.windowRefreshesAt);
      windows.push({id:type,label:windowLabel(seconds),used:clamp(pool.percentageUsed*100),seconds,resetAt:Number.isFinite(at)?at:null,main:true});
    }
    return {plan:data.subscriptionTier==='TIER1'?'pro':data.subscriptionTier==='TIER2'?'ultra':null,windows,models:[],resets:null,credits:null,reached:windows.some(w=>w.used>=100),fetchedAt:now};
  }
  // Native Gemini labels use the browser's local zone. Parse only recognized
  // forms; never let Date.parse invent a year for a partial date.
  function parseResetText(value,observedAt=Date.now()){
    if(typeof value!=='string'||!finite(observedAt))return null;
    const raw=value.replace(/[\u00a0\u202f]/g,' ').trim();
    if(/^\d{4}-\d{2}-\d{2}T/.test(raw)){const at=Date.parse(raw);return finite(at)?at:null;}
    const text=raw.replace(/^(?:resets?|сброс(?:ится)?|обновление)\s*/i,'').trim();
    const relative=text.match(/^in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?)$/i);
    if(relative)return observedAt+Number(relative[1])*(/^d/i.test(relative[2])?86400000:/^h/i.test(relative[2])?3600000:60000);
    const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,янв:0,фев:1,мар:2,апр:3,май:4,мая:4,июн:5,июл:6,авг:7,сен:8,окт:9,ноя:10,дек:11};
    const clock='(\\d{1,2}):(\\d{2})(?:\\s*([AP]M))?';
    const date=text.match(new RegExp('^([A-Za-z]+)\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\s+(?:at\\s+)?'+clock+'$','i'));
    const ru=text.match(new RegExp('^(\\d{1,2})\\s+([А-Яа-яЁё]+)\\.?(?:\\s+(\\d{4}))?\\s+(?:в\\s+)?'+clock+'$','i'));
    const time=text.match(new RegExp('^(?:at\\s+|в\\s+)?'+clock+'$','i'));
    let month,day,year,hour,minute,ampm;
    const observed=new Date(observedAt);let explicit=false;
    if(date||ru){
      const m=date||ru,key=(date?m[1]:m[2]).slice(0,3).toLowerCase();month=months[key];day=Number(date?m[2]:m[1]);year=m[3]?Number(m[3]):observed.getFullYear();hour=Number(m[4]);minute=Number(m[5]);ampm=m[6];explicit=Boolean(m[3]);
    }else if(time){month=observed.getMonth();day=observed.getDate();year=observed.getFullYear();hour=Number(time[1]);minute=Number(time[2]);ampm=time[3];}
    else return null;
    if(month===undefined||minute>59||hour>(ampm?12:23)||(ampm&&hour<1)||day<1||day>31)return null;
    if(ampm)hour=hour%12+(/^pm$/i.test(ampm)?12:0);
    const candidate=new Date(year,month,day,hour,minute,0,0);
    if(candidate.getMonth()!==month||candidate.getDate()!==day)return null;
    if(time&&candidate.getTime()<observedAt-60000)candidate.setDate(candidate.getDate()+1);
    else if(!time&&!explicit&&candidate.getTime()<observedAt-180*86400000)candidate.setFullYear(year+1);
    return candidate.getTime();
  }
  const isLive=usage=>usage?.observation==='event'||Boolean(usage?.source?.includes('event'));
  function displayWindows(usage,now=Date.now()){
    return (usage?.windows||[]).map(w=>!w.resetAt&&w.resetText?{...w,resetAt:parseResetText(w.resetText,usage.fetchedAt),resetFromText:true}:w)
      .filter(w=>!(w.observation==='event'||(w.observation!=='rest'&&isLive(usage)))||(finite(w.resetAt)&&w.resetAt>now));
  }
  function usageHealth(view,now=Date.now()){
    const usage=view?.snapshot?.usage,windows=displayWindows(usage,now);
    const failed=Boolean(view?.error&&(!view.error.includes(':')||view.error.includes('usage:')));
    const at=usage?.fetchedAt?new Date(usage.fetchedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';
    if(isLive(usage))return windows.length?{muted:false,event:true,message:null,note:`Last chat report: ${at}`}:{muted:true,event:true,message:'Reported window ended. Waiting for the next chat usage event.'};
    if(failed&&usage)return {muted:true,message:`Last update failed. Showing the reading from ${at}.`};
    if(usage&&windows.some(w=>w.resetAt&&w.resetAt<=now))return {muted:true,message:'Reset time reached. Waiting for updated usage.'};
    if(usage&&now-usage.fetchedAt>10*60000)return {muted:true,message:`Last successful reading: ${at}. Refresh to update.`};
    return {muted:false,message:null};
  }
  globalThis.LimitsCore={VERSION,finite,parseUsage,parseInit,parseClaude,parseGemini,percent,color,usageTone,usageBarColor,countTone,planLabel,windowLabel,countdown,providers,providerForURL,readPageContext,parseResetText,displayWindows,usageHealth,isLive};
})();

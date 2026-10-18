// Only the Usage surface is inspected. Missing/ambiguous percentages never
// become zero. The native page also performs its own session-authenticated RPCs.
export async function scrapeGeminiPage(context){
  let frame=null,interval=null,timeout=null,waiting='Waiting for Usage document',network='Bridge not observed';
  const startedAt=Date.now();
  const fail=(code,detail)=>({ok:false,error:code,detail});
  try{
    if(location.hostname!=='gemini.google.com')return fail('context','Wrong origin');
    async function identity(doc){
      let email='';
      for(const script of doc.scripts){
        const raw=script.textContent;if(!raw.includes('oPEP7c'))continue;
        const found=raw.match(/"oPEP7c"\s*:\s*("(?:[^"\\]|\\.)*")/);
        if(found){try{email=JSON.parse(found[1]).trim().toLowerCase();}catch{}break;}
      }
      if(!email.includes('@'))return null;
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('gemini/'+context.accountIndex+'/'+email));
      return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('').slice(0,24);
    }
    if(await identity(document)!==context.hint)return fail('context','Active account changed');
    const native=await globalThis.__usageMeterGeminiBridge?.read(context.hint);
    if(!context.fresh&&native&&native.observedAt>=startedAt-60000)return {ok:true,data:native};
    function percent(card){
      const matches=[...card.textContent.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*[%٪]/g)].map(m=>Number(m[1].replace(',','.'))).filter(n=>n>=0&&n<=100);
      if(matches.length===1)return matches[0];
      const aria=card.querySelector('[aria-valuenow]');
      if(aria){
        const raw=aria.getAttribute('aria-valuenow'),max=Number(aria.getAttribute('aria-valuemax')||100),min=Number(aria.getAttribute('aria-valuemin')||0);
        const value=raw?.trim()?Number(raw):NaN;
        if(Number.isFinite(value)&&Number.isFinite(max)&&max>min&&value>=min&&value<=max)return (value-min)/(max-min)*100;
      }
      for(const node of card.querySelectorAll('.progress-indicator,[role="progressbar"] [style],[style*="width"]')){
        const raw=node.getAttribute('style')||'',match=raw.match(/(?:^|[;\s])(?:width|--[\w-]*width)\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
        // CSS-only zero is commonly an animation's initial width. Require an
        // explicit numeric label/ARIA value for zero; both paths above keep it.
        if(match&&Number(match[1])>0&&Number(match[1])<=100)return Number(match[1]);
      }
      return null;
    }
    function extract(doc){
      let current=doc.querySelector('[data-testid="current-usage"],[data-test-id="gxu-currently"],[data-test-id*="currently"],.gxu-currently,.currently-container');
      let weekly=doc.querySelector('[data-testid="weekly-usage"],[data-test-id="gxu-weekly"],[data-test-id*="weekly"],.gxu-weekly,.weekly-container');
      const cards=[...doc.querySelectorAll('.usage-metrics-container .gxu-items-container > *,.usage-metric,.usage-card')];
      current||=cards.find(n=>/current usage|current session|5.hour|текущ|5\s*час/i.test(n.textContent));
      weekly||=cards.find(n=>/weekly|week limit|недел/i.test(n.textContent));
      const native=[...doc.querySelectorAll('.usage-metrics-container .gxu-items-container > *')];
      if(native.length===2){current||=native[0];weekly||=native[1];}
      // Explicit metric names avoid confusing upsell bars or unrelated gauges.
      if(!current||!weekly){waiting='Waiting for native metric cards';return null;}
      const windows=[];
      for(const [card,id,label,seconds] of [[current,'GXU_FIVE_HOURLY','5-hour limit',18000],[weekly,'GXU_WEEKLY','Weekly limit',604800]]){
        const used=percent(card);if(used===null){waiting='Waiting for explicit numeric percentages';return null;}
        const at=Date.parse(card.querySelector('time[datetime]')?.getAttribute('datetime'));
        const reset=card.querySelector('[data-testid*="reset"],.reset-time,.reset-text')||[...card.querySelectorAll('span,p')].find(n=>!n.children.length&&/resets?|сброс/i.test(n.textContent));
        windows.push({id,label,seconds,main:true,used,resetAt:Number.isFinite(at)?at:null,resetText:reset?.textContent?.trim().slice(0,120)||null});
      }
      const raw=doc.querySelector('.usage-metrics-container .tier-pill,.usage-metrics-container .tier-pill-luminous')?.textContent?.trim()||'';
      const plan=/^(?:Google\s+)?(?:AI\s+)?Pro$/i.test(raw)?'pro':/^(?:Google\s+)?(?:AI\s+)?Ultra$/i.test(raw)?'ultra':/^Free$/i.test(raw)?'free':null;
      return {windows,plan,observedAt:Date.now()};
    }
    async function check(doc){
      const bridge=doc.defaultView?.__usageMeterGeminiBridge,info=bridge?.status();
      network=info?`bridge ${info.active?'active':'expired'}, RPCs ${info.matched}, HTTP ${info.http??'none'}, ${info.result}`:'Bridge not observed';
      if(await identity(document)!==context.hint)throw new Error('context');
      const hint=await identity(doc);
      if(!hint){waiting='Waiting for verified Usage account';return null;}
      if(hint!==context.hint)throw new Error('context');
      const captured=await bridge?.read(context.hint);
      if(captured&&captured.observedAt>=startedAt-60000&&(!context.fresh||doc!==document))return captured;
      const data=extract(doc);if(!data)return null;
      return data;
    }
    const onUsage=/\/(?:u\/\d+\/)?usage\/?$/.test(location.pathname);
    if(onUsage&&!context.fresh){const direct=await check(document);if(direct)return {ok:true,data:direct};}
    frame=document.createElement('iframe');frame.dataset.usageMeterProbe='gemini';
    frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
    Object.assign(frame.style,{position:'fixed',left:'0',top:'0',width:'1000px',height:'800px',opacity:'0.001',zIndex:'-2147483647',pointerEvents:'none',border:'0'});
    const prefix=context.accountIndex?'/u/'+context.accountIndex:'';
    frame.src=location.origin+prefix+'/usage';
    return await new Promise(resolve=>{
      let busy=false,done=false,lastSample='',stableSince=0;
      const finish=value=>{if(done)return;done=true;resolve(value);};
      const poll=async()=>{
        if(busy||done)return;busy=true;
        try{
          const doc=frame.contentDocument;
          if(doc?.body){const data=await check(doc);if(data){
            if(data.graphql){finish({ok:true,data});return;}
            const sample=JSON.stringify(data.windows.map(w=>w.used));
            if(sample!==lastSample){lastSample=sample;stableSince=Date.now();}
            else if(Date.now()-stableSince>=1000)finish({ok:true,data});
          }}
        }catch(e){if(e.message==='context')finish(fail('context','Usage page account mismatch'));}
        finally{busy=false;}
      };
      frame.addEventListener('load',poll);frame.addEventListener('error',()=>finish(fail('network','Usage iframe failed to load')));
      interval=setInterval(poll,500);timeout=setTimeout(()=>finish(fail('format',`Usage page: ${waiting} after 40s; ${network}`)),40000);
      document.documentElement.append(frame);
    });
  }catch(e){return fail(e.message==='context'?'context':'network','Usage page inspection failed');}
  finally{clearInterval(interval);clearTimeout(timeout);frame?.remove();}
}
export async function scrapeGemini(tabId,context,options={}){
  // Reuse an existing native Usage tab before loading another copy of the SPA.
  try{
    const tabs=await chrome.tabs.query({url:['https://gemini.google.com/usage*','https://gemini.google.com/u/*/usage*']});
    for(const tab of tabs){
      if(tab.id===tabId)continue;
      const probe=await chrome.scripting.executeScript({target:{tabId:tab.id},func:globalThis.LimitsCore.readPageContext});
      if(probe.find(v=>v.frameId===0)?.result?.hint===context.hint){tabId=tab.id;break;}
    }
  }catch{}
  // Existing documents also need the bridge after an extension update. New
  // iframe navigations get it declaratively at document_start, before scripts.
  await chrome.scripting.executeScript({target:{tabId},world:'MAIN',files:['gemini-bridge.js']});
  const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:scrapeGeminiPage,args:[{hint:context.hint,accountIndex:context.accountIndex,fresh:options.fresh===true}]});
  const data=result.find(v=>v.frameId===0)?.result;
  if(!data?.ok){const e=new Error(data?.error||'network');e.detail=data?.detail||'Usage page script failed';throw e;}
  return data.data;
}

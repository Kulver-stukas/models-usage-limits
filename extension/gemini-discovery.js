/* Read a public Relay descriptor as text. No downloaded code is executed. */
(() => {
  const CDN='https://www.gstatic.com';
  const assetPath=/^\/bg3\/boq-bard-web\/(?:islands|full\/client)\/assets\/UsagePageSurface-[A-Za-z0-9_-]+\.js$/;
  const variables={g1Request:{entrypoints:['GEMINI_USAGE_SETTINGS_UPGRADE_BANNER']},workspaceRequest:{recommendationsForSurfaceRequests:[]}};
  function assets(meta){
    const found=new Set();
    function add(raw){try{const u=new URL(raw);if(u.origin===CDN&&!u.search&&!u.hash&&assetPath.test(u.pathname))found.add(u.href);}catch{}}
    for(const u of meta?.urls||[])add(u);
    for(const [key,value] of meta?.entries||[]){
      const file=key.match(/^@messages\/assets\/(UsagePageSurface-[A-Za-z0-9_-]+\.js)$/)?.[1];
      if(!file||typeof value!=='string')continue;
      const base=value.match(/^(https:\/\/www\.gstatic\.com\/bg3\/boq-bard-web\/(?:islands|full\/client)\/assets\/)(?:[A-Za-z_-]+\/)?UsagePageSurface-messages-[A-Za-z0-9_-]+\.js$/)?.[1];
      if(base)add(base+file);
    }
    return [...found].slice(0,3);
  }
  function metadata(html){
    const entries=[],urls=[];
    for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
      if(/\btype\s*=\s*["']importmap["']/i.test(m[1]))try{
        const data=JSON.parse(m[2]);for(const [k,v] of Object.entries(data.imports||{}))if(k.includes('UsagePageSurface'))entries.push([k,v]);
      }catch{}
      const src=m[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];if(src)urls.push(src);
    }
    return {entries,urls};
  }
  function descriptor(text){
    const found=new Set();
    // Actual current bundles use Relay params.id, not a query_signature field.
    // Limit the match to one small params record and the exact operation name.
    const property=name=>`(?:\\b${name}|["']${name}["'])\\s*:`;
    const records=new RegExp(property('params')+'\\s*\\{([\\s\\S]{0,1200}?)'+property('text')+'\\s*null\\s*\\}','g');
    for(const m of text.matchAll(records)){
      if(!new RegExp(property('name')+'\\s*(["\'`])UsagePageQuery\\1').test(m[1])||!new RegExp(property('operationKind')+'\\s*(["\'`])query\\1').test(m[1]))continue;
      const id=m[1].match(new RegExp(property('id')+'\\s*(["\'`])([A-Za-z0-9+/_=\\-]{16,256})\\1'))?.[2];
      if(id)found.add(id);
    }
    if(found.size!==1)throw new Error('format');
    return {signature:[...found][0],scoped:false,variables:structuredClone(variables)};
  }
  async function discover(context){
    const attempts=[];
    const fail=(error,detail)=>({ok:false,error,detail,attempts});
    try{
      if(location.hostname!=='gemini.google.com')return fail('context','Wrong origin');
      const verify=async()=>{
        const current=await globalThis.LimitsCore.readPageContext();
        if(current?.error||current?.hint!==context.hint||current?.accountIndex!==context.accountIndex)throw new Error('context');
      };
      await verify();
      const entries=[],urls=[...document.scripts].map(s=>s.src).filter(Boolean);
      for(const s of document.querySelectorAll('script[type="importmap"]'))try{
        for(const [k,v] of Object.entries(JSON.parse(s.textContent).imports||{}))if(k.includes('UsagePageSurface'))entries.push([k,v]);
      }catch{}
      if(globalThis.performance?.getEntriesByType)urls.push(...performance.getEntriesByType('resource').map(v=>v.name).filter(v=>v.includes('/UsagePageSurface-')));
      let candidates=assets({entries,urls});
      if(!candidates.length){
        // The public shell is only deployment metadata, never a quota source.
        const response=await fetch(location.origin+'/usage',{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
        if(!response.ok)return fail('network','Public Usage metadata: HTTP '+response.status);
        const html=await response.text();if(html.length>2*1024*1024)return fail('format','Public Usage metadata is too large');
        candidates=assets(metadata(html));attempts.push({stage:'Public Usage metadata',detail:`${candidates.length} matching assets`});
      }
      if(!candidates.length)return fail('format','No UsagePageSurface asset in current import map or public metadata');
      for(const url of candidates){
        try{
          // Google serves these modules with CORS for the Gemini origin.
          const response=await fetch(url,{credentials:'omit',mode:'cors',redirect:'error',cache:'force-cache',signal:AbortSignal.timeout(12000)});
          if(!response.ok)throw new Error('HTTP '+response.status);
          const text=await response.text();if(text.length>2*1024*1024)throw new Error('Asset is too large');
          const query=descriptor(text);await verify();
          return {ok:true,data:query,attempts:[...attempts,{stage:'Gemini Relay descriptor',detail:'UsagePageQuery params.id read from public UsagePageSurface asset'}]};
        }catch(e){if(e.message==='context')throw e;attempts.push({stage:'Gemini Relay descriptor',error:'format',detail:e.message==='format'?'No unambiguous UsagePageQuery params.id':/^HTTP /.test(e.message)?e.message:e.name==='TypeError'?'Asset fetch blocked or unavailable':'Asset could not be read'});}
      }
      return fail('format','No verified UsagePageQuery descriptor in matching assets');
    }catch(e){return fail(e.message==='context'?'context':'network',e.message==='context'?'Active Google account changed':'Descriptor discovery request failed');}
  }
  globalThis.GeminiDiscovery={assets,metadata,descriptor,discover};
})();

(() => {
  const slot='__usageMeterController',version=LimitsCore.VERSION;
  if(window.top!==window)return;
  // Reinjection intentionally replaces the old controller, including after
  // extension reloads where an old page context can still contain its DOM.
  globalThis[slot]?.destroy();
  let host=null,shadow=null,view={},settings={mode:'left',widget:false,widgetLevel:0},revision=-1,tabId=null;
  let disposed=false,lastCookie=null,lastDark=null,dragging=false,lastWake=0,settingsChanged=false;
  let wasGenerating=false,contextBusy=false,lastHeartbeat=0;
  const timers=[];
  const supported=()=>Boolean(LimitsCore.providerForURL(location.href));
  function destroy(){
    disposed=true;timers.forEach(clearInterval);themeObserver.disconnect();
    try{chrome.storage.onChanged.removeListener(onStorage);}catch{}
    document.removeEventListener('visibilitychange',onVisible);
    window.removeEventListener('message',onQuota);
    window.removeEventListener('resize',render);window.removeEventListener('pagehide',onPageHide);
    host?.remove();host=null;
    if(globalThis[slot]?.version===version)delete globalThis[slot];
  }
  async function send(message){
    if(disposed)return;
    try {
      if(!chrome.runtime?.id){destroy();return;}
      return await chrome.runtime.sendMessage(message);
    }catch(error){
      if(!chrome.runtime?.id || /context invalidated|extension.*(disabled|unloaded)|receiving end does not exist/i.test(String(error)))destroy();
    }
  }
  function dark(){
    const node=document.documentElement;
    if(node.classList.contains('dark')||node.classList.contains('dark-theme')||node.dataset.theme==='dark'||node.getAttribute('data-color-mode')==='dark')return true;
    if(node.classList.contains('light')||node.classList.contains('light-theme')||node.dataset.theme==='light'||node.getAttribute('data-color-mode')==='light')return false;
    const scheme=getComputedStyle(node).colorScheme;if(scheme==='dark'||scheme==='light')return scheme==='dark';
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }
  async function theme(){
    const value=dark();if(value!==lastDark){lastDark=value;render();}
    if(value!==publishedDark && document.visibilityState==='visible'){
      publishedDark=value;await send({type:'theme',dark:value});
    }
  }
  function drag(header,card){
    header.onpointerdown=event=>{
      if(event.button!==0 || event.target.closest('button,input'))return;
      const box=host.getBoundingClientRect(),dx=event.clientX-box.left,dy=event.clientY-box.top;
      dragging=true;header.setPointerCapture(event.pointerId);event.preventDefault();
      const move=e=>{
        const x=Math.max(8,Math.min(innerWidth-card.offsetWidth-8,e.clientX-dx));
        const y=Math.max(8,Math.min(innerHeight-card.offsetHeight-8,e.clientY-dy));
        Object.assign(host.style,{left:x+'px',top:y+'px',right:'auto',bottom:'auto'});
      };
      const finish=()=>{
        header.removeEventListener('pointermove',move);header.removeEventListener('pointerup',finish);header.removeEventListener('pointercancel',finish);
        dragging=false;const rect=host.getBoundingClientRect();
        settings={...settings,position:{x:rect.left,y:rect.top}};render();
        void send({type:'settings',value:{position:{x:rect.left,y:rect.top}}});
      };
      header.addEventListener('pointermove',move);header.addEventListener('pointerup',finish);header.addEventListener('pointercancel',finish);
    };
  }
  function render(){
    if(disposed||dragging)return;
    if(!settings.widget||!supported()){host?.remove();host=null;shadow=null;return;}
    if(!host||!host.isConnected) {
      host=document.createElement('div');host.id='usage-meter-widget';
      Object.assign(host.style,{position:'fixed',zIndex:'2147483646',right:'20px',bottom:'20px',width:'min(280px, calc(100vw - 24px))'});
      shadow=host.attachShadow({mode:'open'});document.documentElement.append(host);
    }
    const card=LimitsUI.render(shadow,view,settings,{
      refresh:async b=>{b.disabled=true;try{await send({type:'refresh',force:true});}finally{b.disabled=false;}},
      settings:value=>send({type:'settings',value}),drag,
    },{widget:true,dark:dark()});
    card.style.width='100%';card.style.maxHeight='calc(100vh - 24px)';card.style.overflowY='auto';
    if(settings.position){
      const x=Math.max(8,Math.min(innerWidth-card.offsetWidth-8,settings.position.x));
      const y=Math.max(8,Math.min(innerHeight-card.offsetHeight-8,settings.position.y));
      Object.assign(host.style,{left:x+'px',top:y+'px',right:'auto',bottom:'auto'});
    }
  }
  function apply(value){if(value && value.revision>=revision){view=value;revision=value.revision;}}
  function onStorage(changes,area){
    if(area!=='local'||disposed)return;
    let changed=false;
    if(changes.settings){settings=changes.settings.newValue || settings;settingsChanged=true;changed=true;}
    if(changes.tabViews&&tabId!==null){apply(changes.tabViews.newValue?.[tabId]||{provider:LimitsCore.providerForURL(location.href),snapshot:null,checking:true,revision:revision+1});changed=true;}
    if(changed)render();
  }
  async function context(){
    if(disposed||contextBusy||!supported())return;
    contextBusy=true;
    try{
      const current=await LimitsCore.readPageContext(),key=current?.hint||current?.error;
      if(key===lastCookie&&tabId!==null)return;
      lastCookie=key;view={provider:current?.provider,snapshot:null,checking:true};render();
      const result=await send({type:'context'});
      if(result?.ok){tabId=result.tabId;apply(result.view);
        const data=await chrome.storage.local.get(['tabViews']);apply(data.tabViews?.[tabId]);render();}
      else lastCookie=null;
    }finally{contextBusy=false;}
  }
  function keepObserver(){
    if(disposed||document.visibilityState!=='visible'||LimitsCore.providerForURL(location.href)!=='claude'||Date.now()-lastHeartbeat<60000)return;
    lastHeartbeat=Date.now();window.postMessage({usageMeter:'claude-observer-alive'},location.origin);
  }
  function onVisible(){if(document.visibilityState==='visible'){
    keepObserver();
    void context();void theme();
    if(Date.now()-lastWake>60000){lastWake=Date.now();void send({type:'refresh'});}
    render();
  }}
  function onPageHide(event){if(!event.persisted)destroy();}
  function onQuota(event){
    if(event.source===window&&event.origin===location.origin&&event.data?.usageMeter==='claude-quota-ready'&&LimitsCore.providerForURL(location.href)==='claude')void send({type:'claude-quota'});
  }
  let publishedDark=null;
  const themeObserver=new MutationObserver(()=>{if(document.visibilityState==='visible')void theme();});
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme','data-color-mode']});
  chrome.storage.onChanged.addListener(onStorage);
  document.addEventListener('visibilitychange',onVisible);window.addEventListener('resize',render);window.addEventListener('pagehide',onPageHide);
  window.addEventListener('message',onQuota);
  globalThis[slot]={version,destroy};
  chrome.storage.local.get(['settings']).then(data=>{
    if(disposed)return;if(!settingsChanged)settings=data.settings || settings;view={provider:LimitsCore.providerForURL(location.href),snapshot:null,checking:true};render();keepObserver();void context();void theme();
  }).catch(()=>destroy());
  timers.push(setInterval(()=>{
    if(!chrome.runtime?.id){destroy();return;}
    try{chrome.runtime.getManifest?.();}catch{destroy();return;}
    if(document.visibilityState!=='visible')return;
    keepObserver();
    void context();renderRoute();
    const generating=Boolean(document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label="Stop generating"],button[aria-label="Stop response"],button[aria-label="Stop"],button.stop-button,button[aria-label="Остановить ответ"]'));
    if(wasGenerating&&!generating)void send({type:'refresh'});
    wasGenerating=generating;
  },2500));
  let route=location.pathname;
  function renderRoute(){if(route!==location.pathname){route=location.pathname;render();}}
})();

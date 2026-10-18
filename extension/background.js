import './shared.js';
import {Engine} from './engine.mjs';
import {fingerprint} from './api.mjs';
import {loadProvider} from './providers.mjs';
import {prepareClaude,readClaudeStream} from './claude-live.mjs';
const C=globalThis.LimitsCore;
const patterns=['https://chatgpt.com/*','https://claude.ai/*','https://gemini.google.com/*'];
const defaults={mode:'left',widget:false,widgetLevel:0,position:null};
const records=new Map(),tabs=new Map(),bindingEpoch=new Map();
let settings={...defaults},states={},views={},revision=0,activeId=null,badgeIndex=Math.floor(Date.now()/30000),bindingToken=0,restored=false;
let writes=Promise.resolve(),badgeWrites=Promise.resolve();
function tabView(id){
  const tab=tabs.get(id);
  if(!tab)return {provider:null,snapshot:null,checking:false,unsupported:true};
  return {provider:tab.provider,scope:tab.context?.scope,...(tab.error?{snapshot:null,checking:false,error:tab.error}:views[tab.context?.scope]||{snapshot:null,checking:true}),dark:tab.dark};
}
function paintTab(id){
  // Per-tab action state prevents a slow response from repainting another site.
  badgeWrites=badgeWrites.catch(()=>{}).then(async()=>{
    const view=tabView(id),snapshot=view.snapshot,windows=C.displayWindows(snapshot?.usage).filter(w=>w.main);
    let text='',color='#737b85',title=view.provider?`${C.providers[view.provider].name} Usage`:'Usage Meter';
    if(view.provider){
      if(windows.length){
        const selected=windows[badgeIndex%windows.length];
        const health=C.usageHealth(view),stale=health.muted;
        const due=selected.resetAt&&selected.resetAt<=Date.now();
        text=C.percent(selected.used,settings.mode)+'%';color=stale||due?'#737b85':C.color(selected.used);
        title=[title,snapshot.label,...windows.map(w=>`${w.id===selected.id?'› ':''}${w.label}: ${C.percent(w.used,settings.mode)}% ${settings.mode}`),health.note||health.message||'',due?'Reset due · awaiting update':''].filter(Boolean).join('\n');
      }else if(view.error){text='!';title+=' · '+view.error;}
      else if(snapshot){text='—';title+=' · No percentage reported';}
      else{text='…';title+=' · Checking account';}
    }
    try{
      await chrome.action.setBadgeText({tabId:id,text});
      await chrome.action.setBadgeBackgroundColor({tabId:id,color});
      await chrome.action.setBadgeTextColor({tabId:id,color:'#ffffff'});
      await chrome.action.setTitle({tabId:id,title});
    }catch{} // A tab may close while a badge write is queued.
  });return badgeWrites;
}
function publish(){
  const tabViews=Object.fromEntries([...tabs.keys()].map(id=>[id,{...tabView(id),revision:++revision}]));
  const activeView={...tabView(activeId),revision:++revision};
  const data=structuredClone({providerStates:states,publicViews:views,tabViews,activeView,viewRevision:revision});
  const session=structuredClone({bindingsVersion:C.VERSION,tabBindings:Object.fromEntries(tabs)});
  writes=writes.catch(()=>{}).then(async()=>{
    await chrome.storage.local.set(data);
    if(chrome.storage.session)await chrome.storage.session.set(session);
  });return writes;
}
async function renderAll(){
  await publish();await Promise.all([...tabs.keys()].map(paintTab));
  const rotate=[...tabs.values()].some(t=>(views[t.context?.scope]?.snapshot?.usage?.windows||[]).filter(w=>w.main).length>1);
  if(rotate&&!await chrome.alarms.get('badge'))await chrome.alarms.create('badge',{periodInMinutes:0.5});
  else if(!rotate)await chrome.alarms.clear('badge');
}
function getRecord(context){
  let record=records.get(context.scope);if(record)return record;
  record={context};
  record.engine=new Engine({initial:states[context.scope],load:async options=>{
    const candidate=[...tabs.entries()].filter(([,t])=>t.context?.scope===context.scope&&!t.error).sort(([a],[b])=>(b===activeId)-(a===activeId))[0];
    if(!candidate)throw new Error('context');
    const [id,t]=candidate,result=await loadProvider(t.context,id,options);
    if(tabs.get(id)?.context?.scope!==context.scope)throw new Error('network');
    const current=await chrome.scripting.executeScript({target:{tabId:id},func:C.readPageContext});
    const check=current.find(v=>v.frameId===0)?.result;
    if(!check||check.error||check.hint!==t.context.hint||tabs.get(id)?.context?.scope!==context.scope)throw new Error('context');
    return result;
  },save:async(state,view)=>{
    states[context.scope]=state;views[context.scope]={...view,revision:++revision};await renderAll();
  }});
  const e=record.engine;
  e.confirmed=Boolean(views[context.scope]?.snapshot&&e.accounts[e.selected]);e.error=views[context.scope]?.error||null;
  records.set(context.scope,record);return record;
}
async function bindTab(tab){
  if(!Number.isInteger(tab?.id))return;
  const id=tab.id,epoch=++bindingToken;bindingEpoch.set(id,epoch);
  const provider=C.providerForURL(tab.pendingUrl||tab.url);
  if(!provider){tabs.delete(id);await publish();await paintTab(id);return;}
  const previous=tabs.get(id);
  if(previous?.provider!==provider){tabs.set(id,{provider});await publish();await paintTab(id);}
  let context;
  try{
    const result=await chrome.scripting.executeScript({target:{tabId:id},func:C.readPageContext});context=result.find(v=>v.frameId===0)?.result;
    if(context?.error||context?.provider!==provider||!/^[0-9a-f]{24}$/.test(context.hint||''))throw new Error('context');
    if(provider==='claude'){
      const session=await chrome.cookies.get({url:'https://claude.ai/',name:'sessionKey'});if(!session?.value)throw new Error('auth');
      context.sessionHash=await fingerprint(session.value);context.scope='claude:'+await fingerprint(context.hint+'/'+context.sessionHash);
      try{await prepareClaude(id,context);}catch{}
    }
  }catch(e){
    if(bindingEpoch.get(id)!==epoch)return;
    tabs.set(id,{provider,error:e.message==='auth'?'auth':'context',dark:previous?.dark});await publish();await paintTab(id);return;
  }
  if(bindingEpoch.get(id)!==epoch)return;
  const current=tabs.get(id),changed=current?.context?.scope!==context.scope;
  tabs.set(id,{provider,context,dark:current?.dark});const record=getRecord(context);
  if(provider==='chatgpt')await record.engine.observeContext(context.hint);
  const live=new Set([...tabs.values()].map(t=>t.context?.scope));
  for(const key of Object.keys(states).sort((a,b)=>(states[a].lastAttempt||0)-(states[b].lastAttempt||0))){
    if(Object.keys(states).length<=12)break;
    if(!live.has(key)){delete states[key];delete views[key];records.delete(key);}
  }
  await publish();await paintTab(id);return {record,changed};
}
async function refreshTab(id,force=false){
  let tab;try{tab=await chrome.tabs.get(id);}catch{return;}
  const binding=await bindTab(tab);if(binding)await binding.record.engine.refresh(force);
}
async function captureClaude(id){
  const t=tabs.get(id),context=t?.context,record=context&&records.get(context.scope);
  if(t?.provider!=='claude'||!context?.org||!record?.engine.confirmed)return;
  const before=await chrome.cookies.get({url:'https://claude.ai/',name:'sessionKey'});
  if(!before?.value||await fingerprint(before.value)!==context.sessionHash)return;
  const usage=await readClaudeStream(id,context);if(!usage?.windows?.length)return;
  const after=await chrome.cookies.get({url:'https://claude.ai/',name:'sessionKey'});
  const probe=await chrome.scripting.executeScript({target:{tabId:id},func:C.readPageContext});
  if(after?.value!==before.value||probe.find(v=>v.frameId===0)?.result?.hint!==context.hint||tabs.get(id)?.context?.scope!==context.scope)return;
  const key=await fingerprint('claude/'+context.sessionHash+'/'+context.org);
  await record.engine.acceptUsage(key,usage);
}
async function selectActive(){
  const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});activeId=tab?.id??null;
  if(tab)await bindTab(tab);else await publish();
  if(tabs.get(activeId)?.context)void refreshTab(activeId).catch(()=>{});
}
async function injectOpenTabs(){
  const open=await chrome.tabs.query({url:patterns});
  await Promise.allSettled(open.filter(t=>t.id).map(t=>chrome.scripting.executeScript({target:{tabId:t.id},files:['shared.js','ui.js','content.js']})));
}
async function refreshOpen(){
  const open=await chrome.tabs.query({url:patterns});await Promise.allSettled(open.map(bindTab));
  await Promise.allSettled([...records.values()].filter(r=>[...tabs.values()].some(t=>t.context?.scope===r.context.scope)).map(r=>r.engine.refresh()));
}
const ready=(async()=>{
  const saved=await chrome.storage.local.get(['settings','providerStates','publicViews','engine','publicView','viewRevision','providerBuild']);
  settings={...defaults,...saved.settings};revision=saved.viewRevision||0;
  if(!Number.isInteger(saved.settings?.widgetLevel))settings.widgetLevel=saved.settings?.collapsed?2:0;delete settings.collapsed;
  states=saved.providerStates||{};views=saved.publicViews||{};
  if(saved.providerBuild!==C.VERSION)for(const [scope,state] of Object.entries(states)){
    if(scope==='chatgpt')continue;
    Object.assign(state,{lastAttempt:0,retryAt:0,retryKind:null,failures:0,diagnostics:null});
    if(scope.startsWith('gemini:'))state.providerState={...state.providerState,jsonRetryAt:0,domRetryAt:0,discoveryRetryAt:0};
    if(views[scope])views[scope]={...views[scope],error:null,retryAt:0,diagnostics:null};
  }
  if(!states.chatgpt&&saved.engine){states.chatgpt=saved.engine;views.chatgpt=saved.publicView;}
  await chrome.storage.local.set({settings,providerBuild:C.VERSION});await chrome.action.setBadgeText({text:''});await chrome.action.setTitle({title:'Usage Meter'});
  if(!await chrome.alarms.get('refresh'))await chrome.alarms.create('refresh',{periodInMinutes:5});
  const open=await chrome.tabs.query({url:patterns});
  const session=chrome.storage.session?await chrome.storage.session.get(['bindingsVersion','tabBindings']):{};
  if(session.bindingsVersion===C.VERSION&&session.tabBindings){
    for(const tab of open){
      const saved=session.tabBindings[tab.id],provider=C.providerForURL(tab.url);
      if(!saved?.context||saved.provider!==provider)continue;
      if(provider==='gemini'&&Number(new URL(tab.url).pathname.match(/^\/u\/(\d+)/)?.[1]||new URL(tab.url).searchParams.get('authuser')||0)!==saved.context.accountIndex)continue;
      tabs.set(tab.id,saved);getRecord(saved.context);
    }
    restored=true;
  }else await Promise.allSettled(open.map(bindTab));
  const [active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});activeId=active?.id??null;
  await publish();await Promise.all([...tabs.keys()].map(paintTab));
  if(Number.isInteger(activeId)&&!tabs.has(activeId))await paintTab(activeId);
})();
async function handle(message,sender){
  await ready;
  const page=sender.id===chrome.runtime.id&&sender.tab&&C.providerForURL(sender.url||sender.tab.url),own=sender.id===chrome.runtime.id&&!sender.tab;
  if(!page&&!own)return {ok:false};const id=page?sender.tab.id:activeId;
  switch(message?.type){
    case 'context':{
      if(!page)return {ok:false};const binding=await bindTab(sender.tab);
      if(binding)void binding.record.engine.refresh(binding.changed).catch(()=>{});
      return {ok:true,tabId:id,view:{...tabView(id),revision}};
    }
    case 'theme':{
      if(page&&typeof message.dark==='boolean'){
        if(!tabs.has(id))await bindTab(sender.tab);const t=tabs.get(id);if(t){t.dark=message.dark;await publish();}
      }return {ok:true};
    }
    case 'refresh':if(Number.isInteger(id))await refreshTab(id,message.force===true);return {ok:true};
    case 'claude-quota':if(page==='claude')await captureClaude(id);return {ok:true};
    case 'diagnostics':{
      if(!own)return {ok:false};const view=tabView(id),snapshot=view.snapshot;
      return {ok:true,report:{version:C.VERSION,provider:view.provider||null,error:view.error||null,checking:view.checking===true,
        diagnostics:view.diagnostics||snapshot?.diagnostics||null,usage:snapshot?.usage?{source:snapshot.usage.source||null,windows:snapshot.usage.windows.map(w=>({seconds:w.seconds,used:w.used,resetAt:w.resetAt,main:w.main})),fetchedAt:snapshot.usage.fetchedAt,unavailable:snapshot.usage.unavailable||null}:null}};
    }
    case 'settings':{
      const next=message.value||{};
      if(next.mode==='left'||next.mode==='used')settings.mode=next.mode;if(typeof next.widget==='boolean')settings.widget=next.widget;
      if(Number.isInteger(next.widgetLevel)&&next.widgetLevel>=0&&next.widgetLevel<=2)settings.widgetLevel=next.widgetLevel;
      if(next.position===null)settings.position=null;
      if(next.position&&Number.isFinite(next.position.x)&&Number.isFinite(next.position.y))settings.position={x:next.position.x,y:next.position.y};
      await chrome.storage.local.set({settings:structuredClone(settings)});await renderAll();if(next.widget===true)await injectOpenTabs();return {ok:true};
    }
    case 'open':{
      const provider=tabView(id).provider;
      if(own&&provider){let url=C.providers[provider].usage;const index=tabs.get(id)?.context?.accountIndex;
        if(provider==='gemini'&&index)url=`https://gemini.google.com/u/${index}/usage`;await chrome.tabs.create({url});}
      return {ok:true};
    }
    case 'popup':if(own){await selectActive();return {ok:true,view:{...tabView(activeId),revision},settings};}return {ok:false};
    default:return {ok:false};
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{handle(message,sender).then(respond).catch(()=>respond({ok:false,error:'Extension operation failed'}));return true;});
chrome.tabs.onActivated.addListener(()=>void ready.then(selectActive).catch(()=>{}));
chrome.windows.onFocusChanged.addListener(id=>{if(id!==chrome.windows.WINDOW_ID_NONE)void ready.then(selectActive).catch(()=>{});});
chrome.tabs.onUpdated.addListener((id,change,tab)=>{
  if(!change.url&&change.status!=='complete'&&change.status!=='loading')return;
  void ready.then(async()=>{
    const previous=tabs.get(id),nextURL=change.url||tab.pendingUrl||tab.url,provider=C.providerForURL(nextURL);
    const index=provider==='gemini'?Number(new URL(nextURL).pathname.match(/^\/u\/(\d+)/)?.[1]||new URL(nextURL).searchParams.get('authuser')||0):null;
    if(provider!==previous?.provider||(provider==='gemini'&&previous?.context&&previous.context.accountIndex!==index)){
      bindingEpoch.set(id,++bindingToken);tabs.delete(id);await paintTab(id);await publish();
    }
    if(change.status==='complete'||change.url)await refreshTab(id);
  }).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(id=>{bindingEpoch.delete(id);tabs.delete(id);void ready.then(publish).catch(()=>{});});
chrome.cookies.onChanged.addListener(info=>{
  if(info.cookie.name!=='sessionKey'||!/(^|\.)claude\.ai$/.test(info.cookie.domain.replace(/^\./,'')))return;
  if(info.removed&&info.cause==='overwrite')return;
  void ready.then(async()=>{
    for(const [id,t] of tabs)if(t.provider==='claude'){tabs.set(id,{provider:'claude',dark:t.dark});await paintTab(id);}
    await publish();const open=await chrome.tabs.query({url:'https://claude.ai/*'});await Promise.allSettled(open.map(t=>refreshTab(t.id,true)));
  }).catch(()=>{});
});
chrome.alarms.onAlarm.addListener(alarm=>void ready.then(async()=>{
  if(alarm.name==='refresh')await refreshOpen();
  if(alarm.name==='badge'){
    badgeIndex=Math.floor(Date.now()/30000);await Promise.all([...tabs.keys()].map(paintTab));
    const due=[...records.values()].filter(r=>r.engine.view().snapshot?.usage?.windows?.some(w=>w.main&&w.resetAt&&w.resetAt<=Date.now()));
    await Promise.allSettled(due.map(r=>r.engine.refresh()));
  }
}).catch(()=>{}));
chrome.runtime.onInstalled.addListener(()=>void ready.then(async()=>{await injectOpenTabs();await refreshOpen();await selectActive();}).catch(()=>{}));
chrome.runtime.onStartup.addListener(()=>void ready.then(refreshOpen).catch(()=>{}));
void ready.then(async()=>{
  if(!restored)await Promise.allSettled([...records.values()].map(r=>r.engine.refresh()));
}).catch(()=>{});

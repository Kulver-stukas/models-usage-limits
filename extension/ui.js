(() => {
  if(globalThis.LimitsUI?.version===globalThis.LimitsCore.VERSION)return;
  const C=globalThis.LimitsCore;
  const css=`
  :host{all:initial;display:block;color-scheme:light;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#252b28}
  *{box-sizing:border-box}.meter{--bg:#fff;--fg:#252b28;--muted:#7a817d;--line:#e6e8e7;--track:#ededed;--soft:#f6f7f6;--header:#fafafa;background:var(--bg);color:var(--fg);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:light}
  .meter.dark{--bg:#242825;--fg:#e8ece9;--muted:#a2aaa5;--line:#3b423d;--track:#414742;--soft:#303731;--header:#292e2a;color-scheme:dark}
  button,input{font:inherit}button{cursor:pointer;color:inherit}button:focus-visible,input:focus-visible{outline:2px solid #269b78;outline-offset:2px}
  .card{width:304px;border:1px solid var(--line);border-radius:11px;box-shadow:0 4px 18px #00000012;overflow:hidden}
  .head{display:flex;align-items:center;gap:7px;padding:11px 15px;border-bottom:1px solid var(--line)}
  .brand{font-weight:600;font-size:12px;flex:1;white-space:nowrap}.logo{width:16px;height:16px;color:#269b78;margin-right:7px;vertical-align:-3px}
  .icon{border:0;background:none;border-radius:5px;padding:3px;width:24px;height:24px;color:var(--muted);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
  .icon svg{width:16px;height:16px;display:block}.icon:hover{color:var(--fg);background:var(--track)}.icon:disabled{opacity:.4;cursor:default}
  .tier{font-size:9px;line-height:14px;font-weight:600;letter-spacing:.4px;background:var(--track);border:1px solid var(--line);border-radius:10px;padding:1px 8px;white-space:nowrap}
  .body{padding:16px}.window+.window{margin-top:19px}.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
  .popup-line{display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;font-size:12px}.popup-line .right{text-align:right;font-weight:600}.name{font-size:12px;font-weight:600;min-width:0}.value{font-size:11px;font-weight:600;white-space:nowrap}
  .track{height:6px;background:var(--track);border-radius:4px;overflow:hidden}.fill{height:100%;border-radius:4px;transition:width .2s}
  .popup-window .track{margin-top:8px}.reset{font-size:10px;line-height:1.35;color:var(--muted)}.popup-window .reset{margin-top:6px}
  .widget{font-family:ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,Arial,sans-serif;font-size:13px;line-height:1.4;font-weight:400;letter-spacing:normal;-webkit-font-smoothing:antialiased;--usage-warning:#a16b00;--usage-critical:#d13438}
  .widget.dark{--usage-warning:#f2c45b;--usage-critical:#ff8588}
  .widget [data-tone="warning"]{color:var(--usage-warning)}.widget [data-tone="critical"]{color:var(--usage-critical)}
  .widget .head{padding:8px 12px;background:var(--header);gap:8px}.widget .brand{font-size:13px;font-weight:600;line-height:18px;min-width:0;overflow:hidden;text-overflow:ellipsis}.widget .icon{width:18px;height:18px}.widget .icon svg{width:14px;height:14px}
  .widget .tier{font-size:9px;line-height:12px;font-weight:600;padding:2px 8px}
  .widget .body{padding:12px 16px 14px}.widget .window+.window{margin-top:12px}.widget .name{font-weight:500;font-size:12px}
  .widget .window-head{gap:8px;margin-bottom:4px}.widget .window-head .reset{font-size:10px;line-height:1.4}
  .widget .bar-line{gap:8px}.widget .bar-line .track{height:6px}.widget .bar-line .value{font-size:11px;line-height:1.4;font-weight:700;min-width:26px;font-variant-numeric:tabular-nums}
  .widget .fill{transition:width .2s,background-color .25s}
  .widget .section{font-size:10px;font-weight:600;letter-spacing:.6px;margin:12px 0 6px}.widget .feature+.feature{margin-top:4px}.widget .feature .row{align-items:baseline}.widget .feature .name{font-weight:400}.widget .feature .value{font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}.widget .feature .reset{font-size:10px;line-height:1.4;margin-top:1px}
  .widget .resets{margin-top:8px}
  .window-head{display:flex;align-items:baseline;justify-content:space-between;gap:7px;margin-bottom:5px}.window-head .reset{font-size:9px;white-space:nowrap}
  .bar-line{display:flex;align-items:center;gap:7px}.bar-line .track{flex:1;height:5px}.bar-line .value{font-size:10px;min-width:25px}.bar-line .value:last-child{text-align:right}
  .section{font-size:9px;letter-spacing:.75px;color:var(--muted);text-transform:uppercase;margin:15px 0 9px}.feature+.feature{margin-top:8px}.feature .name{font-weight:400}.feature .reset{margin-top:2px;font-size:9px}.feature .row{gap:8px}.feature .value{font-size:11px}
  .resets{font-size:10px;color:var(--muted);margin-top:12px;display:flex;justify-content:space-between}.resets strong{font-weight:600;color:var(--fg)}
  .status{font-size:10px;line-height:1.45;color:var(--muted);padding:7px 9px;background:var(--soft);border-radius:5px;margin-bottom:10px}.status.warn{color:#b17a16}.section-error{font-size:10px;line-height:1.4;color:#b17a16;margin-bottom:8px}.empty{font-size:11px;line-height:1.5;color:var(--muted)}
  .drag{touch-action:none;cursor:move}.strip .head{padding:6px 8px;border:0;gap:5px;min-height:32px}.strip .tier{padding:0 6px;font-size:8px}.strip-summary{display:flex;gap:8px;flex:1;min-width:0;align-items:center;white-space:nowrap}.strip-item{font-size:10px;display:inline-flex;gap:3px;align-items:baseline;font-variant-numeric:tabular-nums}.strip-label{font-size:9px;color:var(--muted)}.strip-used{font-weight:600}.strip .icon{width:18px;height:18px}.strip .icon svg{width:12px;height:12px}
  .settings .body{padding:16px}.setting{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px}.setting+.setting{margin-top:18px}.setting-note{font-size:10px;line-height:1.5;color:var(--muted);margin-top:10px}
  .segments{display:flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}.segments button{border:0;background:none;padding:5px 9px;font-size:11px;color:var(--muted)}.segments button.selected{background:#269b78;color:#fff}
  .switch{appearance:none;width:30px;height:18px;background:var(--track);border:1px solid var(--line);border-radius:12px;position:relative;margin:0;cursor:pointer;flex-shrink:0}.switch:before{content:"";position:absolute;width:12px;height:12px;background:#fff;top:2px;left:2px;border-radius:50%;box-shadow:0 1px 3px #0002}.switch:checked{background:#269b78;border-color:#269b78}.switch:checked:before{left:14px}
  .text-button{background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:5px 8px;font-size:11px}.details{border-top:1px solid var(--line);margin-top:18px;padding-top:12px;color:var(--muted);font-size:10px;line-height:1.6}.detail-row{display:flex;justify-content:space-between;gap:10px}.detail-row+.detail-row{margin-top:5px}.settings-foot{border-top:1px solid var(--line);padding:11px 16px;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--muted)}.link{background:none;border:0;padding:0;font-size:11px;color:var(--muted);text-decoration:underline}
  `;
  const roots=new WeakMap();
  const paths={
    refresh:['M20 7v5h-5','M4 17v-5h5','M6.1 7a7 7 0 0 1 11.55-1.2L20 9','M4 15l2.35 3.2A7 7 0 0 0 17.9 17'],
    gear:['M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7','M9.5 3h5l.6 2.3 2 .9 2.2-.7 2.5 4.3-1.6 1.7v2l1.6 1.7-2.5 4.3-2.2-.7-2 .9-.6 2.3h-5l-.6-2.3-2-.9-2.2.7-2.5-4.3 1.6-1.7v-2L1.7 9.8l2.5-4.3 2.2.7 2-.9L9.5 3Z'],
    down:['m7 10 5 5 5-5'],up:['m7 14 5-5 5 5'],close:['m7 7 10 10','M17 7 7 17'],back:['m14 6-6 6 6 6'],logo:['M4 20v-5','M10 20V9','M16 20V3'],
  };
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  function svg(name){
    const e=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [k,v] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':name==='logo'?'3':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))e.setAttribute(k,v);
    for(const d of paths[name] || []){const p=document.createElementNS(e.namespaceURI,'path');p.setAttribute('d',d);e.append(p);}return e;
  }
  function button(icon,label,action){const b=el('button','icon');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.dataset.action=action;b.append(svg(icon));return b;}
  function textButton(text,action,cls='text-button'){const b=el('button',cls,text);b.type='button';b.dataset.action=action;return b;}
  const absolute=at=>at?`Resets ${new Date(at).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`:'Reset time unavailable';
  function issue(view,source){
    const errors=view?.snapshot?.errors || [];
    return errors.find(e=>e.startsWith(source+':')) || (view?.error && !view.error.includes(':')?view.error:null);
  }
  function addStatus(body,view){
    if(view?.unsupported){body.append(el('div','status','Open a ChatGPT, Claude, Gemini or Grok tab to see its usage.'));return;}
    const name=C.providers[view?.provider]?.name||'the chat';
    if(!view?.snapshot)body.append(el('div','status',view?.error?`Could not verify usage. Open ${name} and refresh.`:'Checking the current account…'));
    else {const health=C.usageHealth(view);if(health.message)body.append(el('div','status warn',health.message));}
    if(view?.snapshot?.usage?.notice)body.append(el('div','status',view.snapshot.usage.notice));
    if(view?.snapshot?.usage?.reached)body.append(el('div','status warn','Plan limit reached'));
  }
  function addWindows(body,windows,widget){
    for(const w of windows || []){
      const row=el('div',widget?'window':'window popup-window');row.dataset.key=w.id;
      const used=C.percent(w.used,'used'),left=C.percent(w.used,'left');
      const track=el('div','track'),fill=el('div','fill');fill.style.width=used+'%';fill.style.background=widget?C.usageBarColor(w.used):C.color(w.used);track.append(fill);
      for(const [k,v] of Object.entries({role:'progressbar','aria-label':`${w.label}, ${used}% used, ${left}% left`,'aria-valuenow':String(used),'aria-valuemin':'0','aria-valuemax':'100'}))track.setAttribute(k,v);
      if(widget){
        const head=el('div','window-head'),reset=el('span','reset',w.resetAt?absolute(w.resetAt):w.resetText||absolute(null));
        if(w.resetAt)reset.title=new Date(w.resetAt).toLocaleString();head.append(el('span','name',w.label),reset);
        const line=el('div','bar-line'),usedValue=el('span','value',`${used}%`),leftValue=el('span','value',`${left}%`);
        usedValue.dataset.tone=leftValue.dataset.tone=C.usageTone(w.used);line.append(usedValue,track,leftValue);line.title=`${used}% used · ${left}% left`;row.append(head,line);
      }else{
        const head=el('div','popup-line');head.append(el('span','',`${used}% used`),el('span','name',w.label),el('span','right',`${left}% left`));
        const reset=el('div','reset',C.countdown(w.resetAt));if(w.resetAt)reset.title=new Date(w.resetAt).toLocaleString();row.append(head,track,reset);
      }
      if(C.finite(w.remaining)&&C.finite(w.total))row.append(el('div','reset',`${w.remaining} / ${w.total} requests left`));
      body.append(row);
    }
  }
  function addFeatures(body,view){
    if(view?.provider==='grok'){
      const products=view.snapshot?.usage?.products||[];
      if(products.length){body.append(el('div','section','Usage by product'));for(const p of products){const row=el('div','feature'),line=el('div','row');line.append(el('span','name',p.label),el('span','value',`${Math.round(p.percent*10)/10}% used`));row.append(line);body.append(row);}}
      return;
    }
    if(view?.provider!=='chatgpt')return;
    const init=view?.snapshot?.init;
    if(init?.features?.length || issue(view,'features')){
      body.append(el('div','section','Feature limits'));
      if(issue(view,'features'))body.append(el('div','section-error','Feature quotas could not be updated.'));
      for(const f of init?.features || []){
        const item=el('div','feature');item.dataset.key=f.id;const top=el('div','row'),value=el('span','value',`${f.remaining} left`),reference=view.snapshot.featureReferences?.[f.id];
        value.dataset.tone=C.countTone(f.remaining,reference);
        value.title=reference>0?`Colour reference: highest observed remaining count (${reference}) for this account and plan.`:f.remaining===0?'No requests remaining':'Total allowance not reported';
        top.append(el('span','name',f.label),value);item.append(top);
        if(f.resetAt){const reset=el('div','reset',absolute(f.resetAt));reset.title='Server-reported estimate; may move between requests.';item.append(reset);}body.append(item);
      }
    }
    const resets=view?.snapshot?.usage?.resets;
    if(resets?.available>0){const line=el('div','resets');line.append(el('span','','Limit resets'),el('strong','',`${resets.available} available`));line.title=`Applicable now: ${resets.applicable ?? 'not reported'}`;body.append(line);}
  }
  function renderSettings(card,view,settings){
    const body=el('div','body');const widget=el('label','setting');widget.append(el('span','','Floating widget'));
    const toggle=el('input','switch');toggle.type='checkbox';toggle.dataset.action='toggle-widget';toggle.setAttribute('aria-label','Floating widget');toggle.checked=settings.widget===true;widget.append(toggle);body.append(widget);
    const mode=el('div','setting'),segments=el('div','segments');mode.append(el('span','','Toolbar percentage'));
    for(const m of ['used','left']){const b=textButton(m==='used'?'Used':'Left','mode-'+m,m===settings.mode?'selected':'');b.setAttribute('aria-pressed',String(m===settings.mode));segments.append(b);}mode.append(segments);body.append(mode);
    const position=el('div','setting');position.append(el('span','','Widget position'),textButton('Reset','reset-position'));body.append(position);
    body.append(el('div','setting-note','Popup and widget always show used on the left and remaining on the right. This switch changes only the toolbar badge.'));
    const snap=view?.snapshot,usage=snap?.usage,init=snap?.init;const details=el('div','details');
    function line(label,value){const row=el('div','detail-row');row.append(el('span','',label),el('span','',String(value)));details.append(row);}
    line('Account',snap?.label || 'Not verified');
    if(usage?.source)line('Usage source',usage.source);
    for(const product of usage?.products||[])line(product.label+' · shared pool',`${Math.round(product.percent*10)/10}% used`);
    const health=C.usageHealth(view);if(health.note)details.append(el('div','setting-note',health.note));
    if(usage?.unavailable)details.append(el('div','setting-note',usage.unavailable));
    const diagnostics=view?.diagnostics||snap?.diagnostics;
    if(diagnostics?.attempts)for(const a of diagnostics.attempts)line(a.stage,a.detail||a.error||'ok');
    if(diagnostics?.shape)details.append(el('div','setting-note',JSON.stringify(diagnostics.shape)));
    if(usage?.fetchedAt)line('Plan updated',new Date(usage.fetchedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));
    if(init?.fetchedAt)line('Features updated',new Date(init.fetchedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));
    if(usage?.resets)line('Resets',`${usage.resets.available} available · ${usage.resets.applicable ?? '—'} applicable`);
    for(const model of usage?.models || [])line(model.name,model.available?'Available':'Unavailable');
    if(usage?.credits?.hasCredits || usage?.credits?.unlimited)line('Workspace credits',usage.credits.unlimited?'Unlimited':usage.credits.balance ?? 'Available');
    if(init?.maxFileMB)line('Maximum file size',`${init.maxFileMB} MB`);
    if(view?.provider==='chatgpt'&&snap?.plan==='free')details.append(el('div','setting-note','The 30-day plan pool is for reported Work/Codex usage, not all Chat messages.'));
    if(view?.error)details.append(el('div','section-error',view.error));
    if(view?.retryAt>Date.now())line('Next automatic retry',new Date(view.retryAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));
    body.append(details);card.append(body);const footer=el('footer','settings-foot');footer.append(el('span','','Usage Meter · '+C.VERSION));if(view?.provider)footer.append(textButton('Copy diagnostics','diagnostics','link'),textButton('Open Usage','open','link'));card.append(footer);
  }
  // Retain nodes, focus, scroll and progress transitions on ordinary updates.
  function patch(old,fresh){
    if(old.nodeType!==fresh.nodeType || old.nodeName!==fresh.nodeName || (old.nodeType===1 && (old.dataset?.key || '')!==(fresh.dataset?.key || ''))){old.replaceWith(fresh);return fresh;}
    if(old.nodeType===3){if(old.nodeValue!==fresh.nodeValue)old.nodeValue=fresh.nodeValue;return old;}
    for(const attr of Array.from(old.attributes || []))if(!fresh.hasAttribute(attr.name))old.removeAttribute(attr.name);
    for(const attr of Array.from(fresh.attributes || []))if(old.getAttribute(attr.name)!==attr.value)old.setAttribute(attr.name,attr.value);
    if(fresh.tagName==='INPUT'){old.checked=fresh.checked;old.disabled=fresh.disabled;}
    const kids=Array.from(fresh.childNodes);for(let i=0;i<kids.length;i++){if(old.childNodes[i])patch(old.childNodes[i],kids[i]);else old.append(kids[i]);}
    while(old.childNodes.length>kids.length)old.lastChild.remove();return old;
  }
  function bind(root){
    let state=roots.get(root);if(state)return state;state={actions:{},settings:{},busy:false};roots.set(root,state);
    root.addEventListener('click',async event=>{
      const target=event.target.closest?.('[data-action]');if(!target || target.disabled)return;const action=target.dataset.action,a=state.actions;
      if(action==='toggle-widget')return;
      if(action==='refresh'){
        if(state.busy)return;state.busy=true;target.disabled=true;
        try{await a.refresh?.(target);}finally{state.busy=false;const current=root.querySelector('[data-action="refresh"]');if(current)current.disabled=false;}
      }else if(action==='settings')a.navigate?.('settings');
      else if(action==='back')a.navigate?.('overview');
      else if(action==='collapse')a.settings?.({widgetLevel:((state.settings.widgetLevel ?? (state.settings.collapsed?2:0))+1)%3});
      else if(action==='hide')a.settings?.({widget:false});
      else if(action==='mode-used'||action==='mode-left')a.settings?.({mode:action.slice(5)});
      else if(action==='reset-position')a.settings?.({position:null});
      else if(action==='open')a.open?.();
      else if(action==='diagnostics')await a.diagnostics?.(target);
    });
    root.addEventListener('change',event=>{if(event.target.dataset.action==='toggle-widget')state.actions.settings?.({widget:event.target.checked});});return state;
  }
  function render(root,view,settings,actions,{widget=false,dark=false,screen='overview'}={}){
    const state=bind(root);state.actions=actions;state.settings=settings;
    const provider=C.providers[view?.provider],titleText=provider?provider.name+' Usage':'Usage';
    const level=widget?(settings.widgetLevel ?? (settings.collapsed?2:0)):0,strip=widget&&level===2;
    const card=el('section',`meter card${dark?' dark':''}${widget?' widget':''}${strip?' strip':''}${screen==='settings'?' settings':''}`);card.setAttribute('aria-label',widget?titleText+' widget':screen==='settings'?'Usage settings':titleText);card.title=strip?titleText:'';
    if(widget)Object.assign(card.style,{width:'100%',maxHeight:'calc(100vh - 24px)',overflowY:'auto'});
    const header=el('header','head'+(widget?' drag':''));header.dataset.key='header';const snapshot=view?.snapshot,windows=C.displayWindows(snapshot?.usage);
    if(widget){
      if(strip)header.append(el('span','tier',provider?.name||'Usage'));
      else if(snapshot?.plan)header.append(el('span','tier',C.planLabel(snapshot.plan)));
      if(strip){
        const summary=el('div','strip-summary');
        for(const w of windows.filter(w=>w.main)){
          const chip=el('span','strip-item'),short=w.seconds===18000?'5h':w.seconds===604800?'Week':w.seconds%86400===0?`${w.seconds/86400}d`:w.label.replace(' limit','');
          const used=C.percent(w.used,'used'),left=C.percent(w.used,'left'),value=el('span','strip-used',String(used)),remaining=el('span','strip-left',`/${left}%`);value.dataset.tone=remaining.dataset.tone=C.usageTone(w.used);chip.append(el('span','strip-label',short),value,remaining);chip.title=`${w.label}: ${used}% used · ${left}% left`;summary.append(chip);
        }
        if(!summary.childNodes.length)summary.append(el('span','empty',view?.error?'Update unavailable':'Checking…'));summary.title='Used / left';header.append(summary);
      }else header.append(el('span','brand',titleText));
      header.append(button(strip?'up':'down',strip?'Expand widget':level===0?'Show plan limits only':'Collapse to strip','collapse'),button('close','Hide widget','hide'));
    }else if(screen==='settings')header.append(button('back','Back to usage','back'),el('span','brand','Settings'));
    else{
      const title=el('span','brand'),logo=svg('logo');logo.classList.add('logo');title.append(logo,document.createTextNode(titleText));
      const refresh=button('refresh','Refresh usage','refresh');refresh.disabled=state.busy||!provider;header.append(title,button('gear','Settings','settings'),refresh);
    }
    card.append(header);
    if(!widget&&screen==='settings')renderSettings(card,view,settings);
    else if(!strip){
      const body=el('div','body');body.dataset.key='body';addStatus(body,view);addWindows(body,windows,widget);
      if(snapshot&&!windows.length&&!C.usageHealth(view).message)body.append(el('div','empty',snapshot.usage?.unavailable||'No plan percentage reported.'));if(widget&&level===0)addFeatures(body,view);card.append(body);
    }
    let style=root.querySelector('style[data-meter-style]');if(!style){style=el('style');style.dataset.meterStyle='';style.textContent=css;root.append(style);}
    const existing=root.querySelector('.card'),scroll=existing?.scrollTop || 0,current=existing?patch(existing,card):card;if(!existing)root.append(current);
    current.scrollTop=scroll;if(widget)actions.drag?.(current.querySelector('.head'),current);return current;
  }
  globalThis.LimitsUI={version:C.VERSION,render};
})();

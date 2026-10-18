(() => {
  let settings={mode:'left',widget:false,widgetLevel:0},view={unsupported:true},revision=-1;
  let dark=matchMedia('(prefers-color-scheme: dark)').matches,screen='overview',settingsChanged=false,themeChanged=false;
  const app=document.getElementById('app'),send=message=>chrome.runtime.sendMessage(message);
  function render(){
    document.documentElement.classList.toggle('dark',dark);
    LimitsUI.render(app,view,settings,{
      refresh:()=>send({type:'refresh',force:true}),settings:value=>send({type:'settings',value}),
      open:()=>send({type:'open'}),navigate:value=>{screen=value;render();},
      diagnostics:async button=>{
        const result=await send({type:'diagnostics'});if(!result?.ok)return;
        const text=JSON.stringify(result.report,null,2);
        try{await navigator.clipboard.writeText(text);button.textContent='Copied';setTimeout(()=>{if(button.isConnected)button.textContent='Copy diagnostics';},2000);}
        catch{
          const dialog=document.createElement('dialog'),area=document.createElement('textarea'),close=document.createElement('button');
          dialog.style.cssText='width:280px;max-width:95vw';area.value=text;area.readOnly=true;area.style.cssText='width:100%;height:260px;font:10px monospace';close.textContent='Close';close.onclick=()=>dialog.remove();dialog.append(area,close);document.body.append(dialog);dialog.showModal();area.focus();area.select();
        }
      },
    },{dark,screen});
  }
  function apply(v){if(v && v.revision>=revision){view=v;revision=v.revision;}}
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;let changed=false;
    if(changes.settings){settings=changes.settings.newValue || settings;settingsChanged=true;changed=true;}
    if(changes.activeView){apply(changes.activeView.newValue);if(typeof view.dark==='boolean')dark=view.dark;else dark=matchMedia('(prefers-color-scheme: dark)').matches;themeChanged=true;changed=true;}
    if(changed)render();
  });
  chrome.storage.local.get(['settings']).then(async data=>{
    if(!settingsChanged)settings=data.settings || settings;
    render();const result=await send({type:'popup'});
    if(result?.ok){apply(result.view);if(!themeChanged&&typeof result.view?.dark==='boolean')dark=result.view.dark;render();}
  }).catch(()=>{view={error:'Extension unavailable'};render();});
  setInterval(()=>{if(screen==='overview')render();},30000);
})();

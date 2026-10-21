/* Render packaged 0.3.5 UI with clearly labelled example data, no live login. */
const path=require('node:path'),fs=require('node:fs/promises');
const {chromium}=require(process.env.METER_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const source=path.resolve(__dirname,'../artifacts/store-0.3.5/extension'),out=path.resolve(__dirname,'../artifacts/store-assets');await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.METER_CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800},locale:'en-US',timezoneId:'Europe/Moscow'});
  for(const dark of [false,true]){
   await page.setContent(`<html><head><style>body{margin:0;background:${dark?'#171c19':'#f1f5f2'};color:${dark?'#e8ece9':'#26362d'};font:16px system-ui,sans-serif}main{padding:58px 72px}h1{font-size:36px;font-weight:650;margin:0 0 10px}p{margin:0;color:${dark?'#a2b0a6':'#5f7065'};line-height:1.5}.layout{display:flex;gap:44px;align-items:flex-start;margin-top:38px}.col{width:304px}.col h2{font-size:14px;font-weight:600;margin:0 0 14px}.caption{font-size:13px;margin-top:18px;max-width:280px}.example{position:absolute;bottom:32px;left:72px;font-size:12px;color:${dark?'#a2b0a6':'#5f7065'}}.levels>div{margin-bottom:20px;width:280px}</style></head><body><main><h1>Usage Meter</h1><p>${dark?'A compact widget that follows your page theme.':'Your ChatGPT, Claude and Gemini quotas at a glance.'}</p><section class="layout"><div class="col"><h2>Popup · reset countdowns</h2><div id="popup"></div><p class="caption">Used and remaining values together.</p></div><div class="col"><h2>Optional widget · reset dates</h2><div id="widget" style="width:280px"></div><p class="caption">Drag to position. Colours indicate usage.</p></div><div class="col"><h2>Two compact views</h2><div class="levels"><div id="bars"></div><div id="strip"></div></div><p class="caption">Collapse to usage bars, then to a summary strip.</p></div></section><p class="example">Example data · Actual quotas depend on your provider and plan · Version 0.3.5</p></main></body></html>`);
   for(const name of ['shared.js','ui.js'])await page.addScriptTag({path:path.join(source,name)});
   await page.evaluate(dark=>{
    const C=LimitsCore,at=Date.now(),usage=C.parseUsage({rate_limit:{primary_window:{used_percent:38,limit_window_seconds:18000,reset_after_seconds:5400},secondary_window:{used_percent:72,limit_window_seconds:604800,reset_after_seconds:172800}},rate_limit_reset_credits:{available_count:3,applicable_available_count:0}},at);
    const init=C.parseInit({limits_progress:[{feature_name:'deep_research',remaining:25,reset_after:new Date(at+86400000*10).toISOString()},{feature_name:'image_gen',remaining:120,reset_after:new Date(at+86400000).toISOString()}]},at),view={provider:'chatgpt',snapshot:{plan:'team',label:'BUSINESS · demo',usage,init,errors:[]}};
    for(const [id,widget,level] of [['popup',false,0],['widget',true,0],['bars',true,1],['strip',true,2]]){
      const host=document.getElementById(id);host.attachShadow({mode:'open'});LimitsUI.render(host.shadowRoot,view,{widgetLevel:level},{},{widget,dark});
    }
   },dark);
   await page.screenshot({path:path.join(out,`usage-meter-0.3.5-${dark?'dark':'light'}.png`),animations:'disabled'});
  }
  console.log(out);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

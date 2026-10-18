/* Widget typography/colour regression using synthetic quotas only. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.METER_PLAYWRIGHT_MODULE||'playwright');
const extension=path.resolve(__dirname,'../extension');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.METER_CHROMIUM_PATH?{executablePath:process.env.METER_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try{
  const page=await browser.newPage({viewport:{width:640,height:820},locale:'en-US',timezoneId:'Europe/Moscow'});
  await page.setContent('<html><body style="margin:0;padding:20px;background:#f4f4f4;font:20px Georgia;letter-spacing:3px"><main style="display:grid;grid-template-columns:280px 280px;gap:20px"></main></body></html>');
  for(const f of ['shared.js','ui.js'])await page.addScriptTag({path:path.join(extension,f)});
  await page.evaluate(()=>{
   const C=LimitsCore,at=Date.now();window.widgetViews={};
   function mount(id,dark,used,remaining){
    const host=document.createElement('div');host.id=id;host.style.width='280px';document.querySelector('main').append(host);host.attachShadow({mode:'open'});
    const init=C.parseInit({limits_progress:[{feature_name:'deep_research',remaining:remaining[0],reset_after:new Date(at+86400000).toISOString()},{feature_name:'image_gen',remaining:remaining[1],reset_after:new Date(at+3600000).toISOString()},{feature_name:'reason',remaining:remaining[2],reset_after:new Date(at+7200000).toISOString()}]},at);
    const usage=C.parseUsage({rate_limit:{primary_window:{used_percent:used[0],limit_window_seconds:18000,reset_after_seconds:3600},secondary_window:{used_percent:used[1],limit_window_seconds:604800,reset_after_seconds:86400}}},at);
    const view={provider:'chatgpt',snapshot:{plan:id==='business'?'team':'free',usage,init,featureReferences:{deep_research:5,image_gen:5,reason:160},errors:[]}};
    widgetViews[id]={view,dark};LimitsUI.render(host.shadowRoot,view,{widgetLevel:0},{},{widget:true,dark});
   }
   mount('business',false,[38,70],[5,2,160]);mount('free',false,[0,0],[2,1,0]);mount('critical',false,[90,100],[1,0,0]);mount('dark',true,[70,90],[2,1,0]);
  });
  const business=page.locator('#business'),free=page.locator('#free'),dark=page.locator('#dark');
  const style=async locator=>locator.evaluate(n=>{const s=getComputedStyle(n);return {size:s.fontSize,weight:s.fontWeight,family:s.fontFamily,height:s.height,color:s.color,letter:s.letterSpacing};});
  assert.equal((await business.boundingBox()).width,280);assert.equal((await style(business.locator('.brand'))).size,'13px');assert.equal((await style(business.locator('.brand'))).weight,'600');assert(!(await style(business.locator('.brand'))).family.includes('Georgia'));
  assert.equal((await style(business.locator('.window-head .reset').first())).size,'10px');assert.equal((await style(business.locator('.track').first())).height,'6px');assert.equal((await style(business.locator('.feature .value').first())).weight,'700');
  assert.equal(await business.locator('.window').nth(1).locator('.value').first().getAttribute('data-tone'),'warning');
  assert.equal(await free.locator('.feature[data-key="deep_research"] .value').getAttribute('data-tone'),'warning');
  for(const id of ['image_gen','reason'])assert.equal(await free.locator(`.feature[data-key="${id}"] .value`).getAttribute('data-tone'),'critical');
  assert.equal((await style(free.locator('.feature[data-key="deep_research"] .value'))).color,'rgb(161, 107, 0)');assert.equal((await style(free.locator('.feature[data-key="image_gen"] .value'))).color,'rgb(209, 52, 56)');
  assert.equal((await style(dark.locator('.feature[data-key="deep_research"] .value'))).color,'rgb(242, 196, 91)');
  assert.match(await free.locator('.feature .value').first().getAttribute('title'),/highest observed.*5/);
  assert(await page.evaluate(()=>[...document.querySelectorAll('main > div')].every(h=>[...h.shadowRoot.querySelectorAll('.head,.window-head,.bar-line,.feature .row')].every(n=>n.scrollWidth<=n.clientWidth+1))));
  if(process.env.METER_WIDGET_PREVIEW)await page.screenshot({path:process.env.METER_WIDGET_PREVIEW,fullPage:true,animations:'disabled'});
  const first=await business.locator('.fill').first().elementHandle();
  await page.evaluate(()=>{const {view}=widgetViews.business;view.snapshot.usage.windows[0].used=90;LimitsUI.render(document.querySelector('#business').shadowRoot,view,{widgetLevel:0},{},{widget:true});});
  assert(await first.evaluate(n=>n.isConnected));assert.equal(await business.locator('.value').first().getAttribute('data-tone'),'critical');
  await page.evaluate(()=>{const {view}=widgetViews.business;LimitsUI.render(document.querySelector('#business').shadowRoot,view,{widgetLevel:2},{},{widget:true});});
  assert.equal(await business.locator('.strip-used').first().getAttribute('data-tone'),'critical');assert.equal(await business.locator('.strip-left').first().getAttribute('data-tone'),'critical');assert((await business.locator('.strip').boundingBox()).height<=36);
  console.log('PASS: reference-sized widget, isolated sans-serif typography, readable light/dark warnings, five-count rounding, stable updates, no row overflow and compact-strip colours.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

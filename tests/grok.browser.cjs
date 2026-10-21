const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.METER_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.METER_CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try{
 const page=await browser.newPage({viewport:{width:1250,height:800}}),root=path.resolve(__dirname,'../extension');
 await page.setContent('<main style="display:flex;gap:24px"><div id="popup"></div><div id="widget" style="width:280px"></div><div id="paid" style="width:280px"></div></main>');
 for(const f of ['shared.js','ui.js'])await page.addScriptTag({path:path.join(root,f)});
 await page.evaluate(()=>{
 const at=Date.now(),usage={windows:[{id:'fast',label:'Fast · Daily limit',used:80,remaining:6,total:30,seconds:86400,resetAt:null,main:true}],fetchedAt:at,source:'Grok REST'},view={provider:'grok',snapshot:{plan:'free',label:'FREE · test',usage,errors:[]}};
 LimitsUI.render(document.querySelector('#popup'),view,{},{},{});
 const widget=document.querySelector('#widget');widget.attachShadow({mode:'open'});LimitsUI.render(widget.shadowRoot,view,{widgetLevel:0},{},{widget:true});
 const paid=document.querySelector('#paid');paid.attachShadow({mode:'open'});LimitsUI.render(paid.shadowRoot,{provider:'grok',snapshot:{plan:'paid',errors:[],usage:{...usage,windows:[{id:'pool',label:'Weekly usage pool',used:26,seconds:604800,resetAt:at+86400000,main:true}],notice:'Paid Grok support is experimental; live paid accounts have not been tested.',products:[{id:4,label:'Chat',percent:20},{id:5,label:'Imagine',percent:6}]}}},{widgetLevel:0},{},{widget:true,dark:true});
 window.grokView=view;
 });
 for(const id of ['popup','widget']){
  const p=page.locator('#'+id);await p.getByText('Grok Usage',{exact:true}).waitFor();assert.equal(await p.getByText('6 / 30 requests left',{exact:true}).count(),1);assert.equal(await p.getByText('Reset time unavailable',{exact:true}).count(),1);
 }
 assert.equal(await page.locator('#widget .value').first().getAttribute('data-tone'),'warning');
 await page.locator('#paid').getByText('Usage by product',{exact:true}).waitFor();await page.locator('#paid').getByText('20% used',{exact:true}).waitFor();assert.match(await page.locator('#paid .status').textContent(),/experimental/);
 assert(await page.evaluate(()=>['popup','widget','paid'].every(id=>{const host=document.getElementById(id),root=host.shadowRoot||host;return [...root.querySelectorAll('.popup-line,.window-head,.bar-line,.feature .row')].every(n=>n.scrollWidth<=n.clientWidth+1);}))); 
 await page.evaluate(()=>LimitsUI.render(document.querySelector('#widget').shadowRoot,grokView,{widgetLevel:2},{},{widget:true}));assert((await page.locator('#widget .strip').boundingBox()).height<=36);assert.match(await page.locator('#widget .strip-summary').textContent(),/1d/);
 console.log('PASS: Grok Free counts, actual duration, unknown reset, paid shared-pool breakdown, experimental notice, compact strip and no overflow.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

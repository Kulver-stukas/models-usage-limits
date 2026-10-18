const assert=require('node:assert/strict'),path=require('node:path'),http=require('node:http'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.METER_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const {requestInTab,geminiPaths}=await import(pathToFileURL(path.resolve(__dirname,'../extension/providers.mjs')));
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://gemini.google.com');
  if(!u.pathname.includes('executeQuery')){res.setHeader('Content-Type','text/html');res.end('<html></html>');return;}
  if(u.searchParams.has('authuser')){u.searchParams.delete('authuser');res.writeHead(302,{Location:u.pathname+u.search});res.end();return;}
  res.setHeader('Content-Type','application/json');res.end('[{"data":{"viewer":{"rpcs":{"getUsageInfo":{"pools":[]}}}}}]');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.METER_CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 try{
  const context=await browser.newContext();
  const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/app');
  // Shadow only the hostname check so the unmodified function can exercise
  // real browser fetch/redirect behavior against a local HTTP server.
  const run=spec=>page.evaluate(({source,spec})=>Function('location','spec','return ('+source+')(spec)')({hostname:'gemini.google.com',origin:location.origin},spec),{source:requestInTab.toString(),spec});
  const spec={provider:'gemini',accountIndex:0,path:geminiPaths(0,{signature:'2/test-redirect-signature=',scoped:false}).usage};
  // The old fetch policy fails before the JSON parser sees the response.
  assert.equal(await page.evaluate(async path=>{try{await fetch(path,{redirect:'error'});return 'unexpected';}catch(e){return e.name;}},spec.path),'TypeError');
  const valid=await run(spec);assert.equal(valid.ok,true,JSON.stringify(valid));assert(valid.data.includes('getUsageInfo'));
  const wrong=await run({...spec,accountIndex:1,path:geminiPaths(1,{signature:'2/test-redirect-signature=',scoped:false}).usage});assert.equal(wrong.error,'context');
  console.log('PASS: canonical authuser=0 HTTP 302 reproduces old TypeError; corrected transport reads JSON; losing a nonzero Google-account index is rejected.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});

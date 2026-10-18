export async function discoverGemini(tabId,context){
  await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',files:['shared.js','gemini-discovery.js']});
  const results=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:value=>globalThis.GeminiDiscovery.discover(value),args:[{hint:context.hint,accountIndex:context.accountIndex}]});
  const result=results.find(v=>v.frameId===0)?.result;
  if(!result?.ok){const e=new Error(result?.error||'network');e.stage='Gemini descriptor discovery';e.detail=result?.detail||'Browser could not discover the Relay descriptor';e.diagnostics={attempts:result?.attempts||[]};throw e;}
  return result.data;
}

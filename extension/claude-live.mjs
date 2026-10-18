export async function prepareClaude(tabId,context,org=context.org){
  if(!org)return;
  await chrome.scripting.executeScript({target:{tabId},world:'MAIN',files:['claude-bridge.js']});
  await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:value=>{
    if(location.hostname==='claude.ai')globalThis.__usageMeterClaudeBridge?.configure(value);
  },args:[{scope:context.scope,org}]});
}
export async function readClaudeStream(tabId,context,org=context.org){
  if(!org)return null;
  await prepareClaude(tabId,context,org);
  const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:(scope,org)=>{
    return location.hostname==='claude.ai'?globalThis.__usageMeterClaudeBridge?.read(scope,org)||null:null;
  },args:[context.scope,org]});
  return result.find(v=>v.frameId===0)?.result||null;
}

// A bounded fallback for a page-world network failure. Browser cookies stay
// within fetch; explicit account routing and the caller's bootstrap checks apply.
export function geminiResponseContext(request,response,index){
  try{
    const before=new URL(request),after=new URL(response);
    if(after.origin!=='https://gemini.google.com')return 'auth';
    const path=after.pathname.match(/^\/(?:u\/(\d+)\/)?_\/BardChatUi\/graphql\/schemas\/GEMINI_WEB_GRAPHQL\/executeQuery$/);
    if(!path)return 'context';
    const routed=[path[1],after.searchParams.get('authuser')].filter(v=>v!=null);
    if(routed.length?routed.some(v=>!/^\d{1,3}$/.test(v)||Number(v)!==index):index!==0)return 'context';
    if(['query_signature','variables'].some(k=>after.searchParams.get(k)!==before.searchParams.get(k)))return 'context';
    return null;
  }catch{return 'context';}
}
export async function requestGeminiJSON(spec,fetcher=fetch){
  try{
    const index=spec.accountIndex||0,u=new URL(spec.path,'https://gemini.google.com');
    const match=u.pathname.match(/^\/(?:u\/(\d+)\/)?_\/BardChatUi\/graphql\/schemas\/GEMINI_WEB_GRAPHQL\/executeQuery$/);
    if(spec.provider!=='gemini'||!Number.isInteger(index)||index<0||index>999||u.origin!=='https://gemini.google.com'||!match||u.searchParams.get('authuser')!==String(index)||(match[1]!=null&&Number(match[1])!==index))return {ok:false,error:'context',detail:'Invalid Gemini request context'};
    const response=await fetcher(u.href,{credentials:'include',redirect:'follow',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
    const context=response.url&&geminiResponseContext(u.href,response.url,index);if(context)return {ok:false,error:context,detail:'Extension transport: redirected outside selected account'};
    if(!response.ok)return {ok:false,error:response.status===401||response.status===403?'auth':response.status===429?'rate':'network',detail:'Extension transport: HTTP '+response.status};
    const text=await response.text();if(text.length>2*1024*1024)return {ok:false,error:'format',detail:'Usage response is too large'};
    if(text.trimStart().startsWith('<'))return {ok:false,error:'auth',detail:'Extension transport returned sign-in HTML'};
    return {ok:true,data:text};
  }catch(e){return {ok:false,error:'network',detail:'Extension transport: '+(['TypeError','TimeoutError','AbortError'].includes(e.name)?e.name:'Request failed')};}
}

/* Observe only quota records from Claude's own replies. No generation request,
 * conversation fetch, message text extraction or remote transmission. */
(() => {
  if(location.hostname!=='claude.ai'||window.top!==window)return;
  const slot='__usageMeterClaudeBridge',version='0.3.2';
  if(globalThis[slot]?.version===version)return;
  globalThis[slot]?.dispose?.();
  const original=window.fetch;
  let binding=null,epoch=0,latest=null,disposed=false,expires=Date.now()+60000;
  const valid=n=>typeof n==='number'&&Number.isFinite(n);
  function accept(raw,org,started){
    if(disposed||started!==epoch||Date.now()>expires||!raw?.windows)return;
    const windows=[];
    for(const [key,id,seconds] of [['5h','five_hour',18000],['7d','seven_day',604800]]){
      const v=raw.windows[key];if(!v||!valid(v.utilization)||v.utilization<0||v.utilization>1)continue;
      const reset=valid(v.resets_at)?v.resets_at*1000:Date.parse(v.resets_at);
      if(!Number.isFinite(reset)||reset<=Date.now())continue;
      windows.push({id,label:seconds===18000?'5-hour limit':'Weekly limit',seconds,observation:'event',main:true,used:v.utilization*100,resetAt:reset});
    }
    if(!windows.length)return;
    latest={org,epoch:started,usage:{windows,fetchedAt:Date.now(),observation:'event',source:raw.via==='timeline'?'Claude timeline event':'Claude SSE event'}};
    if(binding?.org===org)window.postMessage({usageMeter:'claude-quota-ready'},location.origin);
  }
  // Minimal, bounded protobuf reader. Only the quota field of a timeline event
  // is decoded; conversation update fields remain uninterpreted bytes.
  function fields(bytes){
    const result=new Map();let pos=0;
    const integer=()=>{let n=0;for(let shift=0;shift<=49;shift+=7){if(pos>=bytes.length)throw 0;const b=bytes[pos++];n+=(b&127)*2**shift;if(!(b&128))return n;}throw 0;};
    while(pos<bytes.length){
      const tag=integer(),wire=tag%8,number=Math.floor(tag/8);if(!number)throw 0;let v;
      if(wire===0)v=integer();
      else if(wire===1){if(pos+8>bytes.length)throw 0;v=new DataView(bytes.buffer,bytes.byteOffset+pos,8).getFloat64(0,true);pos+=8;}
      else if(wire===2){const n=integer();if(n>bytes.length-pos)throw 0;v=bytes.subarray(pos,pos+n);pos+=n;}
      else if(wire===5){if(pos+4>bytes.length)throw 0;pos+=4;continue;}else throw 0;
      const list=result.get(number)||[];list.push(v);result.set(number,list);
    }return result;
  }
  const first=(map,key)=>map.get(key)?.[0];
  function timeline(bytes,org,started){
    try{
      const event=first(fields(bytes),1);if(!(event instanceof Uint8Array))return;
      const limit=first(fields(event),4);if(!(limit instanceof Uint8Array))return;
      const windows={},decoder=new TextDecoder();
      for(const entry of fields(limit).get(13)||[]){
        const map=fields(entry),name=first(map,1),value=first(map,2);if(!(name instanceof Uint8Array)||!(value instanceof Uint8Array))continue;
        const key=decoder.decode(name);if(key!=='5h'&&key!=='7d')continue;
        const w=fields(value),stamp=first(w,2),used=first(w,3);
        if(!(stamp instanceof Uint8Array)||!valid(used))continue;
        const at=first(fields(stamp),1);if(valid(at))windows[key]={utilization:used,resets_at:at};
      }
      accept({windows,via:'timeline'},org,started);
    }catch{} // An unknown field/schema is not a zero quota.
  }
  async function observe(response,org,started,connect){
    const reader=response.clone().body?.getReader();if(!reader)return;
    try{
      const decoder=new TextDecoder(),encoding=(response.headers.get('connect-content-encoding')||'gzip').toLowerCase();let text='',buffer=new Uint8Array(0);
      while(!disposed&&started===epoch&&Date.now()<=expires){
        const {done,value}=await reader.read();if(done)break;
        if(connect){
          if(buffer.length+value.length>8*1024*1024)break;
          const next=new Uint8Array(buffer.length+value.length);next.set(buffer);next.set(value,buffer.length);buffer=next;
          let offset=0;
          while(buffer.length-offset>=5){
            const flags=buffer[offset],size=new DataView(buffer.buffer,buffer.byteOffset+offset+1,4).getUint32(0);
            if(size>8*1024*1024)return;if(buffer.length-offset<5+size)break;
            let payload=buffer.subarray(offset+5,offset+5+size);offset+=5+size;
            if(flags&2)continue;
            if(flags&1){if(!['gzip','deflate','deflate-raw'].includes(encoding))return;try{payload=new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new DecompressionStream(encoding))).arrayBuffer());}catch{continue;}}
            timeline(payload,org,started);
          }
          buffer=buffer.slice(offset);
        }else{
          text+=decoder.decode(value,{stream:true});
          const lines=text.split(/\r?\n/);text=lines.pop()||'';if(text.length>256*1024)text='';
          for(const line of lines){
            if(!line.startsWith('data:')||!line.includes('"message_limit"'))continue;
            try{const event=JSON.parse(line.slice(5).trim());if(event.type==='message_limit')accept(event.message_limit,org,started);}catch{}
          }
        }
      }
    }catch{}finally{void reader.cancel().catch(()=>{});}
  }
  async function wrapped(...args){
    const started=epoch;let org=null,completion=false,connect=false;
    try{
      const input=args[0],url=new URL(typeof input==='string'?input:input.url||String(input),location.href);
      if(url.origin===location.origin){
        const cookie=document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('lastActiveOrg='));
        let orgCookie='';try{orgCookie=decodeURIComponent(cookie?.slice(14)||'');}catch{}
        org=url.pathname.match(/^\/api\/organizations\/([a-z0-9-]+)\//i)?.[1]||binding?.org||(/^[a-z0-9-]{8,80}$/i.test(orgCookie)?orgCookie:null);
        const method=String(args[1]?.method||input?.method||'GET').toUpperCase();
        completion=method==='POST'&&/\/(?:retry_)?completion$/.test(url.pathname);
        connect=/\.ConversationService\/StreamTimeline$/.test(url.pathname);
      }
    }catch{}
    const response=await original.apply(this,args);
    if(!disposed&&Date.now()<=expires&&org&&(completion||connect)){
      try{
        const type=response.headers.get('content-type')||'';
        if(response.ok&&(connect||type.includes('event-stream')))void observe(response,org,started,connect);
        else if(completion&&!response.ok)void response.clone().json().then(data=>{
          const raw=data?.error?.message;let limit=typeof raw==='string'?JSON.parse(raw):raw;if(limit?.windows)accept(limit,org,started);
        }).catch(()=>{});
      }catch{}
    }
    return response;
  }
  window.fetch=wrapped;
  function heartbeat(event){
    if(!disposed&&event.source===window&&event.origin===location.origin&&event.data?.usageMeter==='claude-observer-alive')expires=Date.now()+7*60000;
  }
  window.addEventListener('message',heartbeat);
  globalThis[slot]={version,
    configure(value){
      if(!value?.scope||typeof value.org!=='string')return;
      if(binding&&binding.scope!==value.scope){epoch++;latest=null;}
      binding={scope:value.scope,org:value.org};expires=Date.now()+7*60000;
    },
    read(scope,org){
      if(disposed||binding?.scope!==scope||binding?.org!==org||latest?.org!==org||latest.epoch!==epoch)return null;
      const windows=latest.usage.windows.filter(w=>w.resetAt>Date.now());
      return windows.length?{...latest.usage,windows}:null;
    },
    dispose(){disposed=true;latest=null;window.removeEventListener('message',heartbeat);if(window.fetch===wrapped)window.fetch=original;},
  };
})();

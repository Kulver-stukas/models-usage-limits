// Local reset events. Passing a deadline alone is never proof of a reset.
const finite=Number.isFinite,CRITICAL=90,MAX_AGE=10*60000;
export function markerKey(provider,account,plan){
  return provider&&account?JSON.stringify([provider,account,plan||null]):null;
}
export function markerQuotas(view,now=Date.now()){
  const snap=view?.snapshot,usage=snap?.usage;
  return [...(usage?.windows||[]).map(w=>{
    const event=w.observation==='event'||(w.observation!=='rest'&&(usage.observation==='event'||usage.source?.includes('event')));
    let reason=null;
    if(event)reason='This plan reports usage only after a chat reply; background reset confirmation is unavailable.';
    else if(w.resetFromText||usage.source==='Gemini Usage page')reason='Only an estimated reset time is available.';
    else if(!finite(w.resetAt))reason='The provider does not report a reset timestamp.';
    return {id:'window:'+w.id,label:w.label,seconds:w.seconds,used:w.used,resetAt:w.resetAt,
      fetchedAt:usage.fetchedAt,eligible:!reason,reason};
  }),...(snap?.init?.features||[]).map(f=>({id:'feature:'+f.id,label:f.label,eligible:false,
    reason:'Only a remaining count and a reset estimate are reported; a quota reset cannot be verified.'}))];
}
export class ResetMarkers{
  constructor(saved={}){this.preferences=saved.preferences||{};this.records=saved.records||{};}
  export(){return structuredClone({preferences:this.preferences,records:this.records});}
  config(key){return this.preferences[key]||{enabled:false,quotas:[]};}
  configure(key,enabled,ids,view,now){
    if(!key)return;
    const allowed=new Set(markerQuotas(view,now).filter(q=>q.eligible).map(q=>q.id));
    const quotas=[...new Set(ids)].filter(id=>allowed.has(id));
    this.preferences[key]={enabled:enabled===true,quotas};
    // Changing a selection starts observation now, never replays cached events.
    delete this.records[key];
  }
  acknowledge(key){for(const r of Object.values(this.records[key]||{}))delete r.pending;}
  pending(key,now){return Object.values(this.records[key]||{}).some(r=>r.pending?.until>now);}
  update(key,view,now,visible=false){
    const config=this.config(key);
    if(!config.enabled){delete this.records[key];return;}
    const records=this.records[key]||={},selected=new Set(config.quotas);
    for(const id of Object.keys(records)){
      if(!selected.has(id))delete records[id];
      else if(records[id].pending?.until<=now)delete records[id].pending;
    }
    const usage=view?.snapshot?.usage;
    const failed=view?.error&&(!view.error.includes(':')||view.error.includes('usage:'));
    if(!view?.checking&&!failed&&usage){
      for(const q of markerQuotas(view,now)){
        if(!selected.has(q.id))continue;
        if(!q.eligible){delete records[q.id];continue;}
        if(!finite(q.used)||!finite(q.fetchedAt)||q.fetchedAt>now+60000||now-q.fetchedAt>MAX_AGE)continue;
        const prior=records[q.id]||{},signature=JSON.stringify([q.label,q.seconds]);
        const r=prior.signature===signature?prior:{};
        if(q.fetchedAt<=(r.at||0))continue;
        const deadline=r.armed;
        // Require a new authoritative window, fresh recovery out of red, and
        // a reading after the old window ended. Sliding estimates do not count.
        if(deadline&&now>=deadline&&q.fetchedAt>=deadline&&q.resetAt>deadline+60000&&q.resetAt>now){
          if(q.used<CRITICAL&&!visible)r.pending={at:now,until:q.resetAt};
          delete r.armed;
        }
        if(q.used>=CRITICAL){delete r.pending;if(q.resetAt>now)r.armed=q.resetAt;}
        else if(r.armed&&q.fetchedAt<r.armed)delete r.armed;
        Object.assign(r,{at:q.fetchedAt,signature});records[q.id]=r;
      }
    }
    this.records[key]=records;if(visible)this.acknowledge(key);
  }
  nextReset(now){
    const deadlines=Object.entries(this.records).filter(([key])=>this.config(key).enabled)
      .flatMap(([,rows])=>Object.values(rows).map(r=>r.armed)).filter(at=>finite(at)&&at>now);
    return deadlines.length?Math.min(...deadlines):null;
  }
  describe(key,view,now){
    const config=this.config(key),quotas=markerQuotas(view,now);
    const last=Object.keys(this.preferences);
    // Keep the same retention bound as the quota caches.
    if(last.length>60)for(const old of last.slice(0,last.length-60))if(old!==key){delete this.preferences[old];delete this.records[old];}
    return {key,enabled:config.enabled,quotas:quotas.map(q=>({id:q.id,label:q.label,eligible:q.eligible,reason:q.reason,
      selected:config.quotas.includes(q.id)}))};
  }
}

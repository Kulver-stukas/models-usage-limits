// Reuse widget tones. Only a fresh reading can change red into green.
import './shared.js';
const C=globalThis.LimitsCore,finite=Number.isFinite,MAX_AGE=10*60000;
export function markerKey(provider,account,plan){
  return provider&&account?JSON.stringify([provider,account,plan||null]):null;
}
export function markerQuotas(view){
  const snap=view?.snapshot,usage=snap?.usage;
  return [...(usage?.windows||[]).map(w=>{
    const event=w.observation==='event'||(w.observation!=='rest'&&C.isLive(usage));
    const eligible=finite(w.used)&&w.used>=0&&w.used<=100;
    return {id:'window:'+w.id,label:w.label,seconds:w.seconds,source:'usage',
      critical:C.usageTone(w.used)==='critical',resetAt:w.resetAt,fetchedAt:usage.fetchedAt,eligible,
      reason:!eligible?'No numeric usage is reported.':event?'Updates after a normal chat reply; recovery is detected when a new usage event arrives.':null};
  }),...(snap?.init?.features||[]).map(f=>({id:'feature:'+f.id,label:f.label,source:'features',
    critical:C.countTone(f.remaining,snap.featureReferences?.[f.id])==='critical',
    resetAt:f.resetAt,fetchedAt:snap.init.fetchedAt,eligible:finite(f.remaining)&&f.remaining>=0,
    reason:'Uses the widget’s count colours and its highest observed remaining count. Zero is always red.'}))];
}
export class ResetMarkers{
  constructor(saved={}){
    this.preferences=saved.preferences||{};this.records=saved.records||{};
    // Preserve selected quotas and an armed/acknowledged observation on upgrade.
    if(saved.schema!==2)for(const rows of Object.values(this.records))for(const r of Object.values(rows)){
      r.red=finite(r.armed);r.resetAt=r.armed||null;
      r.pending=Boolean(r.pending&&r.pending.until>Date.now());delete r.armed;
    }
  }
  export(){return structuredClone({schema:2,preferences:this.preferences,records:this.records});}
  config(key){return this.preferences[key]||{enabled:false,quotas:[]};}
  configure(key,enabled,ids,view){
    if(!key)return;
    const allowed=new Set(markerQuotas(view).filter(q=>q.eligible).map(q=>q.id));
    const quotas=[...new Set(ids)].filter(id=>allowed.has(id));
    this.preferences[key]={enabled:enabled===true,quotas};
    // A new selection starts observation now, never replays a recovery.
    delete this.records[key];
  }
  acknowledge(key){for(const r of Object.values(this.records[key]||{}))delete r.pending;}
  color(key){
    const config=this.config(key);if(!config.enabled)return null;
    const rows=config.quotas.map(id=>this.records[key]?.[id]).filter(Boolean);
    return rows.some(r=>r.red)?'red':rows.some(r=>r.pending)?'green':null;
  }
  update(key,view,now){
    const config=this.config(key);
    if(!config.enabled){delete this.records[key];return;}
    const records=this.records[key]||={},selected=new Set(config.quotas);
    for(const id of Object.keys(records))if(!selected.has(id))delete records[id];
    if(!view?.checking)for(const q of markerQuotas(view)){
      if(!selected.has(q.id)||!q.eligible)continue;
      const failed=view?.error&&(!view.error.includes(':')||view.error.includes(q.source+':'));
      if(failed||!finite(q.fetchedAt)||q.fetchedAt>now+60000||now-q.fetchedAt>MAX_AGE)continue;
      const prior=records[q.id]||{},signature=JSON.stringify([q.label,q.source==='features'?'count':q.seconds]);
      const r=prior.signature===signature?prior:{};
      if(q.fetchedAt<=(r.at??-Infinity))continue;
      if(q.critical){r.red=true;delete r.pending;}
      else if(r.red){r.red=false;r.pending=true;}
      Object.assign(r,{at:q.fetchedAt,signature,resetAt:q.resetAt});records[q.id]=r;
    }
    this.records[key]=records;
  }
  nextReset(now){
    // Provider dates can bring the next check forward, but never change colour.
    const deadlines=Object.entries(this.records).filter(([key])=>this.config(key).enabled)
      .flatMap(([,rows])=>Object.values(rows).filter(r=>r.red).map(r=>r.resetAt)).filter(at=>finite(at)&&at>now);
    return deadlines.length?Math.min(...deadlines):null;
  }
  describe(key,view){
    const config=this.config(key),quotas=markerQuotas(view);
    const last=Object.keys(this.preferences);
    // Keep the same retention bound as the quota caches.
    if(last.length>60)for(const old of last.slice(0,last.length-60))if(old!==key){delete this.preferences[old];delete this.records[old];}
    return {key,enabled:config.enabled,quotas:quotas.map(q=>({id:q.id,label:q.label,eligible:q.eligible,reason:q.reason,
      selected:config.quotas.includes(q.id)}))};
  }
}

// All writers go through this coordinator; tabs never submit quota values.
export class Engine {
  constructor({load,save,now=Date.now,initial={}}) {
    this.load=load;this.save=save;this.now=now;
    this.accounts=initial.accounts || {};this.selected=initial.selected || null;
    this.hint=initial.hint ?? null;this.confirmed=false;this.error=null;
    this.epoch=0;this.inflight=null;this.lastAttempt=initial.lastAttempt || 0;
    this.retryAt=initial.retryAt || 0;this.failures=initial.failures || 0;
    this.retryKind=initial.retryKind || null;
    this.featureRetryAt=initial.featureRetryAt || 0;this.featureFailures=initial.featureFailures || 0;
    this.featureError=initial.featureError || null;
    this.providerState=initial.providerState||{};this.diagnostics=initial.diagnostics||null;this.writes=Promise.resolve();
  }
  view() {
    return {snapshot:this.confirmed?this.accounts[this.selected] || null:null,
      checking:!this.confirmed,error:this.error,retryAt:this.retryAt,featureRetryAt:this.featureRetryAt,diagnostics:this.diagnostics};
  }
  persist() {
    const state=structuredClone({accounts:this.accounts,selected:this.selected,hint:this.hint,
      lastAttempt:this.lastAttempt,retryAt:this.retryAt,failures:this.failures,retryKind:this.retryKind,
      featureRetryAt:this.featureRetryAt,featureFailures:this.featureFailures,featureError:this.featureError,diagnostics:this.diagnostics,providerState:this.providerState});
    const view=structuredClone(this.view());
    this.writes=this.writes.catch(()=>{}).then(()=>this.save(state,view));
    return this.writes;
  }
  async observeContext(hint) {
    if (typeof hint!=='string' || !hint || hint===this.hint) return false;
    const first=this.hint===null;
    this.hint=hint;
    if (!first) {
      this.epoch++;this.confirmed=false;this.error=null;this.retryAt=0;this.lastAttempt=0;this.failures=0;this.retryKind=null;
      this.featureRetryAt=0;this.featureFailures=0;this.featureError=null;
      this.providerState={};this.diagnostics=null;
    }
    await this.persist();return !first;
  }
  async acceptUsage(key,usage){
    if(!this.confirmed||key!==this.selected||!usage?.windows?.length)return false;
    const old=this.accounts[key];
    if(old.usage?.windows?.length&&old.usage.fetchedAt>usage.fetchedAt)return false;
    this.accounts[key]={...old,usage:{...usage,models:[],resets:null,credits:null,reached:usage.windows.some(w=>w.main&&w.used>=100)},errors:(old.errors||[]).filter(e=>!e.startsWith('usage:'))};
    this.error=this.accounts[key].errors.join(' · ')||null;this.retryAt=0;this.failures=0;this.retryKind=null;
    await this.persist();return true;
  }
  async refresh(force=false) {
    if (this.inflight) {
      const active=this.inflight;
      await active;
      // If a context notification invalidated the in-flight call, verify again.
      if (!this.confirmed && this.retryAt===0) return this.refresh(force);
      return this.view();
    }
    const now=this.now();
    if ((now<this.retryAt && (!force || this.retryKind==='rate')) ||
      (this.lastAttempt>0 && now-this.lastAttempt<(force?15000:60000))) return this.view();
    this.lastAttempt=now;const generation=this.epoch;
    this.inflight=(async()=>{
      try {
        const skipFeatures=this.now()<this.featureRetryAt && (!force || this.featureError?.includes(': rate'));
        const bundle=await this.load({skipFeatures,force,providerState:structuredClone(this.providerState),previousUsage:this.accounts[this.selected]?.usage});
        if (generation!==this.epoch) return;
        if(bundle.providerState)this.providerState=bundle.providerState;
        if(bundle.deferred){await this.persist();return;}
        if (!bundle.key) throw new Error('context');
        const old=this.accounts[bundle.key] || {};
        const activeLive=old.usage?.source?.includes('event')?old.usage.windows.filter(w=>w.resetAt>this.now()):[];
        if(activeLive.length&&bundle.usage&&(!bundle.usage.windows.length||old.usage.fetchedAt>bundle.usage.fetchedAt))bundle.usage={...old.usage,windows:activeLive};
        this.selected=bundle.key;this.confirmed=true;
        const errors=[...(bundle.errors || [])];
        const featureError=errors.find(e=>e.startsWith('features:'));
        if(bundle.initSkipped){if(this.featureError)errors.push(this.featureError);}
        else if(featureError){
          this.featureFailures++;this.featureError=featureError;
          this.featureRetryAt=this.now()+Math.min(30*60000,60000*2**Math.min(this.featureFailures-1,5));
        }else {this.featureFailures=0;this.featureRetryAt=0;this.featureError=null;}
        this.diagnostics=bundle.diagnostics||null;
        this.accounts[bundle.key]={...old,label:bundle.label,plan:bundle.plan,diagnostics:bundle.diagnostics||null,
          ...(bundle.usage?{usage:bundle.usage}:{}),...(bundle.init?{init:bundle.init}:{}),
          errors,verifiedAt:this.now()};
        const keys=Object.keys(this.accounts).filter(k=>k!==this.selected).sort((a,b)=>(this.accounts[a].verifiedAt || 0)-(this.accounts[b].verifiedAt || 0));
        while(Object.keys(this.accounts).length>5)delete this.accounts[keys.shift()];
        this.error=errors.length?errors.join(' · '):null;
        if(!bundle.usage && errors.some(e=>e.startsWith('usage:'))) {
          this.retryKind=errors.some(e=>e.startsWith('usage: rate'))?'rate':'network';
          this.failures++;this.retryAt=this.now()+Math.min(30*60000,60000*2**Math.min(this.failures-1,5));
        } else {this.failures=0;this.retryAt=0;this.retryKind=null;}
      } catch(e) {
        if (generation!==this.epoch) return;
        this.failures++;
        this.error=['auth','context','rate','format'].includes(e.message)?e.message:'network';
        this.diagnostics=e.diagnostics||null;
        if(e.providerState)this.providerState=e.providerState;
        this.retryKind=this.error;
        // Never show an old workspace after an unverified session change.
        if(e.message==='auth'||e.message==='context')this.confirmed=false;
        this.retryAt=this.now()+Math.min(30*60000,60000*2**Math.min(this.failures-1,5));
      }
      if(generation===this.epoch)await this.persist();
    })().finally(()=>{this.inflight=null;});
    await this.inflight;return this.view();
  }
}

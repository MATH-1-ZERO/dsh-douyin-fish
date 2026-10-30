// Read-only account wallet integration. Credentials stay inside DSH's account service.
const decimal=/^(-?)(\d*(?:\.\d*)?)(?:e([+-]?\d+))?$/i;
function amount(value){
 if(typeof value!=='string'||value.length>128)throw Error('invalid_wallet');
 const m=decimal.exec(value);if(!m||!/[0-9]/.test(m[2]))throw Error('invalid_wallet');
 const [whole='',fraction='']=m[2].split('.'),exponent=Number(m[3]||0);
 if(Math.abs(exponent)>40||whole.length+fraction.length>60)throw Error('invalid_wallet');
 let scale=fraction.length-exponent,n=BigInt((m[1]||'')+(whole+fraction));
 if(scale<0){n*=10n**BigInt(-scale);scale=0;}
 if(scale>60)throw Error('invalid_wallet');
 return {n,scale};
}
function add(a,b){const scale=Math.max(a.scale,b.scale);return {n:a.n*10n**BigInt(scale-a.scale)+b.n*10n**BigInt(scale-b.scale),scale};}
function print({n,scale}){
 const negative=n<0n;if(negative)n=-n;
 let digits=n.toString().padStart(scale+1,'0');
 if(scale)digits=(digits.slice(0,-scale)+'.'+digits.slice(-scale)).replace(/0+$/,'').replace(/\.$/,'');
 return (negative?'-':'')+digits;
}
export function projectWallets(result){
 if(result?.status!=='ready'||!Array.isArray(result.value)||!Array.isArray(result.bonusWallets))throw Error('invalid_wallet');
 const rows=new Map();
 for(const [key,wallets] of [['recharge',result.value],['bonus',result.bonusWallets]]){
  if(wallets.length>8)throw Error('invalid_wallet');
  const seen=new Set();
  for(const wallet of wallets){
   if(!['CNY','USD'].includes(wallet?.currency)||seen.has(wallet.currency))throw Error('invalid_wallet');
   seen.add(wallet.currency);
   if(!rows.has(wallet.currency))rows.set(wallet.currency,{currency:wallet.currency,recharge:null,bonus:null});
   rows.get(wallet.currency)[key]=amount(wallet.balance);
  }
 }
 return [...rows.values()].map(row=>({currency:row.currency,
  recharge:row.recharge===null?null:print(row.recharge),bonus:row.bonus===null?null:print(row.bonus),
  total:row.recharge===null||row.bonus===null?null:print(add(row.recharge,row.bonus)),
 }));
}
const fallback={status:'unavailable',source:'DSH 账号钱包',scope:'account',wallets:[],fetchedAt:null,checkedAt:null,usageUrl:null,refreshing:false};
const copy=value=>structuredClone(value);
// Cordis get() returns a new context-aware proxy on every lookup. Compare its
// original identity only; all operations still run through the scoped proxy.
const serviceIdentity=service=>service?.[Symbol.for('cordis.original')]??service;
const usageLink=value=>{try{const url=new URL(value);return url.origin==='https://platform.deepseek.com'&&url.pathname==='/usage'&&!url.search&&!url.hash&&!url.username&&!url.password?url.href:null;}catch{return null;}};

export class FishBilling{
 constructor({account,selection,now=Date.now,version='0.8.0-dev.17',timeoutMs=35000,ttlMs=60000,retryMs=30000,minRefreshMs=10000}){
  Object.assign(this,{account,selection,now,version,timeoutMs,ttlMs,retryMs,minRefreshMs});
  this.value=copy(fallback);this.generation=0;this.service=null;this.pending=null;this.nextCheck=0;this.lastStarted=null;this.closed=false;
 }
 invalidate(){this.generation++;this.value=copy(fallback);this.nextCheck=0;this.lastStarted=null;}
 async bind(service){
  const identity=serviceIdentity(service);
  if(identity===this.identity&&(this.watchActive||this.now()<(this.watchRetryAt??0)))return this.ready;
  this.watchController?.abort();this.invalidate();this.service=service;this.identity=identity;
  this.watchController=new AbortController();const {signal}=this.watchController;this.watchActive=true;
  // Watch only opaque state changes; never request a token, profile or platform session.
  this.ready=new Promise(resolve=>{
   let first=true;
   this.watching=(async()=>{try{
    for await(const _state of service.watch(signal)){
     if(signal.aborted)break;
     if(first){first=false;resolve();}else this.invalidate();
    }
   }catch{if(!signal.aborted)this.invalidate();}
   finally{if(this.watchController.signal===signal){this.watchActive=false;this.watchRetryAt=this.now()+this.retryMs;}resolve();}})();
  });
  return this.ready;
 }
 async bounded(promise,ms=this.timeoutMs){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('billing_timeout')),ms);})]);}finally{clearTimeout(timer);}
 }
 pendingView(generation){
  if(this.closed||generation!==this.generation)return copy(fallback);
  const pending=this.pending;
  if(!pending||pending.settled)return copy(this.value);
  if(pending.generation!==generation)return {...copy(fallback),status:'loading',refreshing:true,reason:'account_change_pending'};
  return {...copy(this.value),status:this.value.fetchedAt===null?'loading':this.value.status,refreshing:true,usageUrl:pending.usageUrl};
 }
 async read({role='owner',force=false,wait=true}={}){
  if(role!=='owner')return null;
  if(this.closed)return copy(fallback);
  let service,selection;
  try{service=this.account();selection=this.selection();}catch{return {...copy(fallback),reason:'host_unavailable'};}
  if(selection?.provider!=='deepseek-account'){
   this.watchController?.abort();this.service=null;this.identity=null;this.invalidate();return {...copy(fallback),reason:'account_provider_not_selected'};
  }
  if(!service||!['getState','getBalance','watch'].every(key=>typeof service[key]==='function')){this.watchController?.abort();this.service=null;this.identity=null;this.invalidate();return {...copy(fallback),reason:'account_service_unavailable'};}
  try{await this.bounded(this.bind(service),3000);}catch{return {...copy(fallback),reason:'account_state_unavailable'};}
  if(!this.watchActive)return {...copy(fallback),reason:'account_state_unavailable'};
  const generation=this.generation;
  let state;try{state=await this.bounded(service.getState(),3000);}catch{return {...copy(fallback),reason:'account_state_unavailable'};}
  if(this.closed||generation!==this.generation)return copy(fallback);
  if(state?.status!=='credential-stored'){this.invalidate();return {...copy(fallback),status:'signed_out',reason:'account_sign_in_required'};}
  const now=this.now();
  if(this.pending){if(!wait)return this.pendingView(generation);if(this.pending.generation===generation){const value=await this.pending.result;return this.closed||generation!==this.generation?copy(fallback):copy(value);}return {...copy(fallback),status:'loading',refreshing:true,reason:'account_change_pending'};}
  if(now<this.nextCheck&&(!force||this.lastStarted!==null&&now-this.lastStarted<this.minRefreshMs))return copy(this.value);
  this.lastStarted=now;
  const previous=this.value,usageUrl=usageLink(state.links?.usageUrl),pending={generation,usageUrl,settled:false};
  const request=Promise.resolve().then(()=>service.getBalance({version:this.version,locale:'zh-CN',timezoneOffsetSeconds:-new Date().getTimezoneOffset()*60}));
  pending.result=(async()=>{
   let value;
   try{
    const result=await this.bounded(request);
    if(result===null)value={...copy(fallback),status:'signed_out',reason:'account_changed_or_signed_out'};
    else value={...copy(fallback),status:'ready',wallets:projectWallets(result),fetchedAt:this.now(),checkedAt:this.now(),usageUrl};
   }catch{
    value=previous.fetchedAt!==null?{...previous,status:'stale',checkedAt:this.now(),reason:'balance_refresh_failed'}:{...copy(fallback),status:'failed',checkedAt:this.now(),usageUrl,reason:'balance_refresh_failed'};
   }
   pending.settled=true;
   if(this.closed||generation!==this.generation)return copy(fallback);
   this.value=value;this.nextCheck=this.now()+(value.status==='ready'?this.ttlMs:this.retryMs);return copy(value);
  })();
  this.pending=pending;
  // If a host implementation exceeds the UI deadline, keep its request single-flight until it settles.
  void Promise.allSettled([request,pending.result]).then(()=>{if(this.pending===pending)this.pending=null;});
  if(!wait)return this.pendingView(generation);
  const value=await pending.result;return this.closed||generation!==this.generation?copy(fallback):copy(value);
 }
 close(){this.closed=true;this.watchController?.abort();this.service=null;this.identity=null;this.invalidate();}
}

export function createBillingReader(ctx){
 const get=name=>typeof ctx.get==='function'?ctx.get(name):ctx[name];
 return new FishBilling({account:()=>get('deepseekAccount'),selection:()=>get('agentDefaultModel')?.currentSelection?.()});
}

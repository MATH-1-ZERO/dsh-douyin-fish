import test from 'node:test';
import assert from 'node:assert/strict';
import {FishBilling,projectWallets,createBillingReader} from './billing.js';
import {consoleView} from './console-view.js';
import {freshState} from './engine.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const balance=(a='0.10',b='0.20')=>({status:'ready',value:[{currency:'CNY',balance:a}],bonusWallets:[{currency:'CNY',balance:b}],token:'must-not-escape'});
function fixture(t,options={}){
 let clock=100000,calls=0,stateCalls=0,provider='deepseek-account',resolveChange,wake=false;
 let state={status:'credential-stored',links:{usageUrl:'https://platform.deepseek.com/usage'}},load=async()=>balance();
 const account={getState:async()=>{stateCalls++;return state;},getBalance:async metadata=>{calls++;assert.equal(metadata.locale,'zh-CN');assert.equal(typeof metadata.timezoneOffsetSeconds,'number');return load();},async *watch(signal){
  const notify=()=>{wake=true;resolveChange?.();};signal.addEventListener('abort',notify,{once:true});
  try{yield state;while(!signal.aborted){if(!wake)await new Promise(resolve=>{resolveChange=resolve;});wake=false;if(!signal.aborted)yield state;}}finally{signal.removeEventListener('abort',notify);}
 }};
 const reader=new FishBilling({account:()=>account,selection:()=>({provider}),now:()=>clock,...options});t.after(()=>reader.close());
 return {reader,account,get calls(){return calls;},get stateCalls(){return stateCalls;},load(fn){load=fn;},advance(ms){clock+=ms;},provider(value){provider=value;},async change(next=state){state=next;wake=true;resolveChange?.();await tick();}};
}
test('wallets preserve exact decimal cents, exponents, negatives and separate currencies',()=>{
 assert.deepEqual(projectWallets(balance())[0],{currency:'CNY',recharge:'0.1',bonus:'0.2',total:'0.3'});
 assert.equal(projectWallets(balance('0E-16','5.0000000000000000'))[0].total,'5');
 assert.equal(projectWallets(balance('9007199254740993.01','.02'))[0].total,'9007199254740993.03');
 assert.equal(projectWallets(balance('-0.2','1e-3'))[0].total,'-0.199');
 const mixed=balance();mixed.value.push({currency:'USD',balance:'1'});mixed.bonusWallets.push({currency:'USD',balance:'2'});
 assert.deepEqual(projectWallets(mixed).map(w=>w.total),['0.3','3']);
});
test('missing wallets and malformed balances never become zero or a fabricated total',()=>{
 assert.deepEqual(projectWallets({status:'ready',value:[],bonusWallets:[]}),[]);
 assert.deepEqual(projectWallets({...balance(),bonusWallets:[]})[0],{currency:'CNY',recharge:'0.1',bonus:null,total:null});
 for(const value of ['NaN','Infinity','','.','0<script>','1e99999999','1'.repeat(129)])assert.throws(()=>projectWallets(balance(value)));
 assert.throws(()=>projectWallets({...balance(),value:[{currency:'XYZ',balance:'1'}]}));
 assert.throws(()=>projectWallets({...balance(),value:[{currency:'CNY',balance:'1'},{currency:'CNY',balance:'2'}]}));
});
test('activation and guest reads have no account side effects or private projections',async t=>{
 const f=fixture(t);assert.equal(f.calls,0);assert.equal(await f.reader.read({role:'guest'}),null);assert.equal(f.stateCalls,0);
 const data=await f.reader.read(),guest=consoleView(freshState(),{role:'guest',billing:data});
 assert.equal(Object.hasOwn(guest,'billing'),false);assert.equal(Object.hasOwn(guest,'usage'),false);
 assert.ok(!JSON.stringify(data).includes('must-not-escape'));assert.equal(data.scope,'account');
});
test('concurrent opens and polling share one query; manual refresh has a minimum interval',async t=>{
 const f=fixture(t);let release;f.load(()=>new Promise(resolve=>{release=resolve;}));
 const a=f.reader.read(),b=f.reader.read();await tick();assert.equal(f.calls,1);release(balance());
 assert.deepEqual(await a,await b);await tick();await f.reader.read();await f.reader.read({force:true});assert.equal(f.calls,1);
 f.advance(10000);f.load(async()=>balance('1','2'));assert.equal((await f.reader.read({force:true})).wallets[0].total,'3');assert.equal(f.calls,2);
 await tick();f.advance(60000);await f.reader.read();assert.equal(f.calls,3);
});
test('errors retain visibly stale balances and initial failures never imply zero',async t=>{
 const f=fixture(t);f.load(async()=>{throw Error('sensitive-secret-detail');});
 const failed=await f.reader.read();assert.equal(failed.status,'failed');assert.equal(failed.fetchedAt,null);assert.deepEqual(failed.wallets,[]);assert.ok(!JSON.stringify(failed).includes('secret'));
 await tick();f.advance(30000);f.load(async()=>balance('0','0'));const first=await f.reader.read();assert.equal(first.wallets[0].total,'0');
 await tick();f.advance(60000);f.load(async()=>({status:'failed'}));const stale=await f.reader.read();assert.equal(stale.status,'stale');assert.equal(stale.fetchedAt,first.fetchedAt);assert.equal(stale.wallets[0].total,'0');
});
test('account change discards a pending old response and clears previous cached wallets',async t=>{
 const f=fixture(t);await f.reader.read();await tick();await f.change();let release;f.load(()=>new Promise(resolve=>{release=resolve;}));
 const old=f.reader.read();await tick();await f.change();release(balance('987','654'));assert.deepEqual((await old).wallets,[]);await tick();
 f.load(async()=>balance('3','4'));assert.equal((await f.reader.read()).wallets[0].total,'7');
 await f.change({status:'signed-out'});const out=await f.reader.read();assert.equal(out.status,'signed_out');assert.deepEqual(out.wallets,[]);
});
test('null balance and a provider change clear account data without probing other credentials',async t=>{
 const f=fixture(t);await f.reader.read();await tick();f.advance(60000);f.load(async()=>null);assert.equal((await f.reader.read()).status,'signed_out');
 f.provider('another-api-provider');const value=await f.reader.read();assert.equal(value.reason,'account_provider_not_selected');assert.deepEqual(value.wallets,[]);assert.equal(f.calls,2);
});
test('timeout keeps the underlying request single-flight and ignores late balance results',async t=>{
 const f=fixture(t,{timeoutMs:20});let release;f.load(()=>new Promise(resolve=>{release=resolve;}));
 assert.equal((await f.reader.read()).status,'failed');f.advance(60000);assert.equal((await f.reader.read({force:true})).status,'failed');assert.equal(f.calls,1);
 release(balance('987','654'));await tick();f.load(async()=>balance('1','2'));assert.equal((await f.reader.read()).wallets[0].total,'3');
});
test('official usage links cannot carry credentials, tracking parameters or another origin',async t=>{
 const f=fixture(t);
 for(const url of ['https://evil.invalid/usage','javascript:alert(1)','https://platform.deepseek.com/usage?token=secret','https://secret@platform.deepseek.com/usage']){
  await f.change({status:'credential-stored',links:{usageUrl:url}});assert.equal((await f.reader.read()).usageUrl,null);await tick();
 }
});
test('closing during a request discards the response and prevents future queries',async t=>{
 const f=fixture(t);let release;f.load(()=>new Promise(resolve=>{release=resolve;}));const pending=f.reader.read();await tick();f.reader.close();release(balance());assert.deepEqual((await pending).wallets,[]);await f.reader.read();assert.equal(f.calls,1);
});

test('the console can open and poll while its first account balance is still pending',{timeout:2000},async t=>{
 const f=fixture(t);let release;f.load(()=>new Promise(resolve=>{release=resolve;}));
 const opening=await f.reader.read({wait:false});assert.equal(opening.status,'loading');assert.equal(opening.refreshing,true);assert.deepEqual(opening.wallets,[]);
 await tick();assert.equal(f.calls,1);const next=await f.reader.read({wait:false});assert.equal(next.refreshing,true);assert.equal(f.calls,1);
 release(balance());await tick();const ready=await f.reader.read({wait:false});assert.equal(ready.status,'ready');assert.equal(ready.refreshing,false);assert.equal(ready.wallets[0].total,'0.3');
});
test('background refresh identifies old data and changes to stale on failure',{timeout:2000},async t=>{
 const f=fixture(t);const first=await f.reader.read();await tick();f.advance(60000);let reject;f.load(()=>new Promise((_,no)=>{reject=no;}));
 const pending=await f.reader.read({wait:false});assert.equal(pending.refreshing,true);assert.equal(pending.fetchedAt,first.fetchedAt);assert.deepEqual(pending.wallets,first.wallets);
 await tick();reject(Error('network'));await tick();const stale=await f.reader.read({wait:false});assert.equal(stale.status,'stale');assert.equal(stale.refreshing,false);assert.deepEqual(stale.wallets,first.wallets);
});
test('account watch can recover after a transient host failure without serving old cached balances',async t=>{
 const f=fixture(t),watch=f.account.watch;let broken=true;
 f.account.watch=async function*(signal){if(broken)throw Error('host restarting');yield*watch(signal);};
 assert.equal((await f.reader.read()).reason,'account_state_unavailable');assert.equal(f.calls,0);
 broken=false;f.advance(30000);assert.equal((await f.reader.read()).status,'ready');assert.equal(f.calls,1);
});

test('fresh Cordis wrappers share the cache but a real replacement service clears it',{timeout:2000},async t=>{
 const a=fixture(t),b=fixture(t);let account=a.account,release;
 a.load(()=>new Promise(resolve=>{release=resolve;}));b.load(async()=>balance('3','4'));
 const scopedAccount=()=>new Proxy(account,{get(target,key,receiver){return key===Symbol.for('cordis.original')?target:Reflect.get(target,key,receiver);}});
 const reader=createBillingReader({get(name){return name==='deepseekAccount'?scopedAccount():{currentSelection:()=>({provider:'deepseek-account'})};}});t.after(()=>reader.close());
 for(let i=0;i<4;i++)assert.equal((await reader.read({wait:false})).refreshing,true);
 assert.equal(a.calls,1);release(balance());await tick();
 for(let i=0;i<4;i++){const view=await reader.read({wait:false});assert.equal(view.status,'ready');assert.equal(view.wallets[0].total,'0.3');}
 assert.equal(a.calls,1);
 account=b.account;assert.equal((await reader.read()).wallets[0].total,'7');assert.equal(b.calls,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rmdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {resetOwnerConversation,reloadOwnerDocument,visitOwnerConversation,sendOwnerDm} from '../../src/owner-dm.js';
import {freshState} from '../../src/engine.js';
import {withUiPage} from '../../src/browser/scoped-ui.mjs';

test('panel reset closes once and waits for disappearance; empty panels need no click',async()=>{
 let reads=0,closes=0,time=0;
 const result=await resetOwnerConversation({inspect:async()=>({ready:true,closed:++reads===4}),closeOnce:async()=>closes++,wait:async ms=>time+=ms,now:()=>time});
 assert.equal(result.ready,true);assert.equal(result.closeClicked,true);assert.equal(closes,1);assert.equal(reads,4);
 const empty=await resetOwnerConversation({inspect:async()=>({ready:true,closed:true}),closeOnce:async()=>assert.fail('already closed')});
 assert.equal(empty.closeClicked,false);
});

test('panel close failure, input refusal and cancellation never repeat a click or reload',async()=>{
 let closes=0,time=0;
 const stuck=await resetOwnerConversation({inspect:async()=>({ready:true,closed:false}),closeOnce:async()=>closes++,wait:async ms=>time+=ms,now:()=>time,timeoutMs:500});
 assert.equal(stuck.reason,'owner_dm_panel_not_closed');assert.equal(closes,1);
 const refused=await resetOwnerConversation({inspect:async()=>({ready:false,reason:'existing_input_preserved'}),closeOnce:async()=>assert.fail('input must survive')});
 assert.equal(refused.reason,'existing_input_preserved');
 const controller=new AbortController();
 await assert.rejects(resetOwnerConversation({signal:controller.signal,inspect:async()=>({ready:true,closed:false}),closeOnce:async()=>controller.abort(Error('stop'))}),/stop/);
});

async function fixture(t,{stuck=false,moved=false,reload='changed'}={}){
 const directory=await mkdtemp(join(tmpdir(),'fish-owner-navigation-'));t.after(()=>rmdir(directory));
 let state=freshState(),panel=true,currentPhase,closeReads=0,documentId=1,time=0,sent=false;
 const owner={verified:true,platformId:'owner_verified_123',ownerHandle:'owner_handle'},profile='https://www.douyin.com/user/'+owner.platformId;
 state.resources.ownerIdentity=owner;state.resources.persona={ownerId:owner.platformId};state.resources.development={enabled:true,readsTotal:0,lastReadAt:null};
 const calls={close:0,open:0,send:0,reload:0,options:[]};
 const store={directory,snapshot:async()=>structuredClone(state),transact:async fn=>{const r=await fn(structuredClone(state));state=r.state;return r.value;}};
 const session={armForegroundOnce(){},armHoverOnce(){},armPointerOnce(){},armTextInputOnce(){},async send(method,args){
  if(method==='Runtime.evaluate'){
   const expr=args.expression;let value;
   if(expr.includes('function captureProfile'))value={ready:true,url:profile,labels:['抖音号:'+owner.ownerHandle],profileNames:['主人']};
   else if(expr.includes('"phase":"closed"'))value={ready:true,closed:!panel};
   else if(expr.includes('"phase":"point_close"')){currentPhase='close';value={ready:true,point:{x:moved&&++closeReads===2?11:10,y:10}};}
   else if(expr.includes('"phase":"point_open"')){currentPhase='open';value={ready:true,point:{x:20,y:20}};}
   else if(expr.includes('"phase":"refresh_profile"')){
    calls.reload++;
    if(reload==='changed'||reload==='exception_new'){documentId++;panel=false;}
    if(reload==='exception_old'||reload==='exception_new')throw Error('Execution context was destroyed');
    value=reload==='refused'?{ready:false,reason:'owner_profile_changed'}:{ready:true,refreshRequested:true};
   }
   else if(expr.includes('"phase":"point_send"')){currentPhase='send';value={ready:true,point:{x:30,y:30}};}
   else if(expr.includes('"phase":"verify_input"'))value={ready:true,filled:true};
   else if(expr.includes('"phase":"input_guard"'))value={ready:true};
   else if(expr.includes('"phase":"receipt"')||expr.includes('"phase":"inspect"')&&expr.includes('function boundOwnerDm'))value={ready:true,editorEmpty:true,matches:sent?[{pendingOrFailed:false,layout:{flexDirection:'row-reverse'}}]:[]};
   else if(expr.includes('"phase":"inspect"'))value={ready:true,pageVisible:true,headerMatchesOwner:panel,headerCount:panel?1:0,editors:panel?[{}]:[]};
   else value={ready:true,pageVisible:true};
   return {result:{value}};
  }
  if(method==='Input.dispatchMouseEvent'&&args.type==='mouseReleased'){
   calls[currentPhase]++;if(currentPhase==='send')sent=true;else if(currentPhase==='open')panel=true;else if(!stuck)panel=false;
  }
  return {};
 }};
 const deps={store,delay:async ms=>{time+=ms;},monotonicNow:()=>time,withUiPage:async(_profile,fn)=>fn({session,sessionId:'session',contextId:1,targetId:'owner-target',frameId:'owner-frame',loaderId:'document-'+documentId}),profileRunner:async(target,fn,opts)=>{
  assert.equal(target,profile);calls.options.push(opts);
  try{return {success:true,result:await fn({signal:opts.signal}),bindingVerified:true,browserReused:true,browserRetained:true,sessionReleased:true};}
  catch(error){return {success:false,error:error.message};}
 }};
 return {deps,calls,settings:{manualBrowser:{enabled:true}},get state(){return state;}};
}

test('consecutive visits reopen the verified owner panel without profile reload; delivery refresh remains explicit',async t=>{
 const f=await fixture(t);
 for(let i=0;i<2;i++){
  const r=await visitOwnerConversation(f.settings,{confirm:'visit_verified_owner_conversation'},f.deps);
  assert.equal(r.allowed,true);assert.equal(r.diagnostic.closeClicked,true);
 }
 assert.equal(f.calls.close,2);assert.equal(f.calls.open,2);assert.equal(f.calls.reload,0);assert.ok(f.calls.options.every(o=>o.reloadIfSame===false));
 const sent=await visitOwnerConversation(f.settings,{confirm:'visit_verified_owner_conversation'},f.deps,async({reopen})=>{await reopen('回复');return {verified:true};});
 assert.equal(sent.allowed,true);assert.equal(f.calls.reload,1);assert.equal(f.calls.close,3);assert.equal(f.calls.open,4);
});

test('stuck or moved close controls stop the visit without opening or refreshing as fallback',async t=>{
 for(const condition of ['stuck','moved']){
  const f=await fixture(t,{[condition]:true});
  const r=await visitOwnerConversation(f.settings,{confirm:'visit_verified_owner_conversation'},f.deps);
  assert.equal(r.allowed,false);assert.equal(r.diagnostic.stage,'close_panel');assert.equal(r.diagnostic.automaticRetryAllowed,false);
  assert.equal(f.calls.close,condition==='stuck'?1:0);assert.equal(f.calls.open,0);assert.equal(f.calls.reload,0);
 }
});

test('scoped page returns the browser-checked target, main frame and document loader identity',async()=>{
 const home=resolve('work/mock-owner-reload'),target='https://www.douyin.com/user/owner_verified_123';
 let closed=false;
 const session={close(){closed=true;},async send(method,args){
  if(method==='Browser.getBrowserCommandLine')return {arguments:['--enable-automation','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--user-data-dir='+join(home,'.dsh','douyin-fish-public-test')]};
  if(method==='Target.getTargets')return {targetInfos:[{type:'page',url:target,targetId:'owner-target'}]};
  if(method==='Target.attachToTarget'){assert.equal(args.targetId,'owner-target');return {sessionId:'owner-session'};}
  if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'owner-frame',loaderId:'owner-document',url:target}}};
  if(method==='Page.createIsolatedWorld'){assert.equal(args.frameId,'owner-frame');return {executionContextId:1};}
  assert.fail('Unexpected browser operation '+method);
 }};
 const result=await withUiPage(target,async({targetId,frameId,loaderId})=>({targetId,frameId,loaderId}),{home,connection:async()=>session});
 assert.deepEqual(result,{targetId:'owner-target',frameId:'owner-frame',loaderId:'owner-document'});assert.equal(closed,true);
});

test('document reload evidence requires a changed loader in the same target and main frame',async()=>{
 const before={targetId:'target',frameId:'frame',loaderId:'old'};
 for(const changed of [{...before},{...before,targetId:'other',loaderId:'new'},{...before,frameId:'other',loaderId:'new'},{...before,loaderId:undefined}]){
  let reads=0,reloads=0,time=0;
  const result=await reloadOwnerDocument({inspect:async()=>++reads===1?before:changed,refreshOnce:async()=>{reloads++;return {ready:true};},wait:async ms=>{time+=ms;},now:()=>time,timeoutMs:500});
  assert.equal(result.reason,'owner_dm_persistence_reload_unverified');assert.equal(reloads,1);assert.ok(reads<=3);
 }
 let reads=0;
 const result=await reloadOwnerDocument({inspect:async()=>++reads===1?before:{...before,loaderId:'new'},refreshOnce:async()=>{throw Error('Destroyed context');}});
 assert.equal(result.documentChanged,true);assert.equal(reads,2);
});

test('missing pre-reload document evidence or cancellation refuses before another operation',async()=>{
 const missing=await reloadOwnerDocument({inspect:async()=>({targetId:'target',frameId:'frame'}),refreshOnce:async()=>assert.fail('No verified original document')});
 assert.equal(missing.reason,'owner_dm_persistence_reload_unverified');assert.equal(missing.reloadAttempted,false);
 const controller=new AbortController();let reads=0;
 await assert.rejects(reloadOwnerDocument({signal:controller.signal,inspect:async()=>{reads++;return {targetId:'target',frameId:'frame',loaderId:'old'};},refreshOnce:async()=>{controller.abort(Error('stop'));throw Error('Old context lost');}}),/stop/);
 assert.equal(reads,1);
});

test('an acknowledged, refused or failed refresh of the old document keeps the send uncertain and cannot resend',async t=>{
 for(const reload of ['unchanged','refused','exception_old']){
  const f=await fixture(t,{reload});
  const result=await sendOwnerDm(f.settings,{confirm:'send_one_exact_owner_dm',text:'刷新验证测试'},f.deps);
  assert.equal(result.allowed,false,reload);assert.equal(result.persistenceVerified,false);
  assert.equal(result.interaction.status,'uncertain');assert.equal(result.interaction.error,'owner_dm_persistence_reload_unverified');
  assert.equal(f.state.resources.interactionAttempts[0].status,'uncertain');
  assert.equal(f.calls.send,1);assert.equal(f.calls.reload,1);assert.equal(f.calls.close,1);assert.equal(f.calls.open,1);
  const retry=await sendOwnerDm(f.settings,{confirm:'send_one_exact_owner_dm',text:'刷新验证测试'},f.deps);
  assert.equal(retry.allowed,false);assert.equal(retry.reason,'interaction_result_unresolved');assert.equal(f.calls.send,1);assert.equal(f.calls.reload,1);
 }
});

test('only a new verified document permits post-send reopening and persistence confirmation, including a destroyed old context',async t=>{
 for(const reload of ['changed','exception_new']){
  const f=await fixture(t,{reload});
  const result=await sendOwnerDm(f.settings,{confirm:'send_one_exact_owner_dm',text:'新文档验证测试'},f.deps);
  assert.equal(result.allowed,true,reload);assert.equal(result.persistenceVerified,true);assert.equal(result.interaction.status,'confirmed');
  assert.equal(f.state.resources.interactionAttempts[0].status,'confirmed');
  assert.equal(f.calls.send,1);assert.equal(f.calls.reload,1);assert.equal(f.calls.close,1);assert.equal(f.calls.open,2);
 }
});

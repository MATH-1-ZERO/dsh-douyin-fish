import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshState,validateState} from './engine.js';
import {FishAutonomy,freshAutonomy} from './autonomy.js';
const base=JSON.parse(await readFile(new URL('./settings.json',import.meta.url),'utf8'));
const persona=JSON.parse(await readFile(new URL('./personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
const T=Date.parse('2026-10-24T12:00:00+08:00'),sourceRef='https://www.douyin.com/video/7551370789157637436';
function fixture(mode='comment'){
 let s=freshState(),reads=0,models=0,deliveries=0;
 s.resources.persona=structuredClone(persona);s.resources.persona.ownerId='owner_verified_123';s.resources.ownerIdentity={verified:true,platformId:'owner_verified_123',ownerHandle:'owner_handle'};
 s.resources.autonomy={...freshAutonomy(),enabled:true,deliveryMode:mode};s.resources.development={enabled:true,readsTotal:0,lastReadAt:null};s.paused=false;
 const store={snapshot:async()=>structuredClone(s),transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}};
 const worker=new FishAutonomy({store,loadBase:async()=>base,now:()=>T,setTimer:()=>({unref(){}}),clearTimer(){},read:async()=>{reads++;return {allowed:true,untrustedMaterial:{text:'小鲸鱼端着白米饭',sourceRef}};},generate:async(p,{commit})=>{
  models++;assert.equal(p.writingRules.persona.includes('老大'),true);const r=await commit('老大，小鱼发现一碗白米饭。',mode==='review'?undefined:{action:['share_link','share_card','mention_owner'].includes(mode)?mode:'comment'});return {allowed:r.allowed,status:'draft_saved'};
 },deliver:async(_settings,request,deps)=>{
  deliveries++;assert.equal(request.sourceRef,sourceRef);assert.equal(deps.autonomous,true);assert.equal(deps.autonomyLeaseId,s.resources.autonomy.inFlightId);assert.equal(s.resources.manualDrafts.at(-1).status,'send_uncertain');
  return {allowed:true,interaction:{status:'confirmed',attemptId:'12345678-1234-1234-1234-123456789abc'}};
 }});
 return {worker,store,get state(){return s;},get reads(){return reads;},get models(){return models;},get deliveries(){return deliveries;}};
}
for(const mode of ['comment','share_link'])test(mode+' binds a saved draft to the just-read video and delivers at most once',async()=>{
 const f=fixture(mode);const r=await f.worker.tick();assert.equal(r.allowed,true);assert.equal(r.action,mode);assert.equal(r.publicVisibilityVerified,false);assert.equal(f.deliveries,1);
 assert.equal(f.state.resources.manualDrafts[0].status,'confirmed_sent');assert.equal(f.state.resources.manualDrafts[0].kind,mode==='share_link'?'dm':'comment');
 await f.worker.tick();assert.equal(f.deliveries,1);assert.equal(f.models,1);
});
test('review mode remains draft-only and automatic mode requires its own explicit start value',async()=>{
 const f=fixture('review');await f.worker.tick();assert.equal(f.deliveries,0);assert.equal(f.state.resources.manualDrafts[0].status,'copy_only_unsent');
 assert.equal((await f.worker.start('start_browse_and_drafts','comment')).reason,'explicit_start_required');
});
test('generation error pauses persistently and does not reopen the browser on a timer tick',async()=>{
 const f=fixture('review');f.worker.generate=async()=>{throw Error('agent id "undefined" does not match session id "session-1"');};
 await f.worker.tick();assert.equal(f.state.paused,true);assert.equal(f.state.resources.autonomy.enabled,false);assert.equal(f.state.resources.autonomy.inFlightId,null);
 await f.worker.tick();assert.equal(f.reads,1);assert.equal(f.deliveries,0);
});
test('model identity probe failure blocks startup before any browser or enabled state change',async()=>{
 const f=fixture('review');await f.worker.stop();f.worker.generate.probe=async()=>{throw Error('identity mismatch');};
 const r=await f.worker.start('start_browse_and_drafts');assert.equal(r.reason,'model_bridge_probe_failed');assert.equal(f.reads,0);assert.equal(f.state.paused,true);
});
test('unresolved attempts block automatic delivery before reading even in development mode',async()=>{
 const f=fixture();await f.store.transact(s=>{s.resources.interactionAttempts=[{id:'12345678-1234-1234-1234-123456789abc',kind:'like',at:T,key:'a'.repeat(64),status:'uncertain',receiptId:null}];return {state:s,value:null};});
 assert.equal((await f.worker.tick()).reason,'interaction_result_unresolved');assert.equal(f.reads,0);assert.equal(f.models,0);
});
test('an uncertain delivery leaves its draft uncertain and stops the worker',async()=>{
 const f=fixture();f.worker.deliver=async()=>({allowed:false,interaction:{status:'uncertain',attemptId:'12345678-1234-1234-1234-123456789abc'}});
 await f.worker.tick();assert.equal(f.state.paused,true);assert.equal(f.state.resources.manualDrafts[0].status,'send_uncertain');assert.equal(f.state.resources.autonomy.enabled,false);
});
test('model skip never calls the delivery adapter',async()=>{
 const f=fixture('comment_or_share_link');f.worker.generate=async p=>{assert.deepEqual(p.actionChoices,['comment','share_link','skip']);return {allowed:true,status:'skipped'};};
 assert.equal((await f.worker.tick()).status,'skipped');assert.equal(f.deliveries,0);assert.equal(f.state.resources.manualDrafts.length,0);
});
test('one-cycle delivery never starts a timer and always pauses after one model and one dispatch',async()=>{
 const f=fixture();await f.worker.stop();f.worker.setTimer=()=>{throw Error('Single test must not install a timer');};
 const r=await f.worker.runOnce('run_one_autonomous_delivery_test','comment');assert.equal(r.allowed,true);assert.equal(r.singleCycle,true);assert.equal(f.models,1);assert.equal(f.deliveries,1);assert.equal(f.state.paused,true);assert.equal(f.state.resources.autonomy.enabled,false);assert.equal(f.worker.live,false);
 await f.worker.tick();assert.equal(f.models,1);assert.equal(f.deliveries,1);
});
test('new native modes require real owner confirmation before reading or model use',async()=>{
 for(const mode of ['share_card','comment_or_share_card','mention_owner']){const f=fixture(mode);await f.worker.stop();const r=await f.worker.runOnce('run_one_autonomous_delivery_test',mode);assert.match(r.reason,/live_verification_required/);assert.equal(f.reads,0);assert.equal(f.models,0);}
});
test('verified native choices are delivered once and keep the exact source and owner-bound lease',async()=>{
 for(const mode of ['share_card','mention_owner']){
  const f=fixture(mode),attemptId='22222222-2222-2222-2222-222222222222',kind=mode==='share_card'?'nativeCard':'nativeMention';
  await f.store.transact(s=>{s.resources.interactionAttempts=[{id:attemptId,kind:mode==='share_card'?'dm':'comment',at:T-10,key:'c'.repeat(64),status:'confirmed',receiptId:'owner-proof',ownerConfirmedReceived:true,...(mode==='mention_owner'?{nativeMentionOwnerId:'owner_verified_123'}:{})}];s.resources.liveVerification={[kind]:{attemptId,ownerId:'owner_verified_123',videoId:'7551370789157637436',at:T-1,source:'owner_confirmation',notificationVerified:mode==='mention_owner',publicVisibilityVerified:mode==='mention_owner'}};return {state:s,value:null};});
  const r=await f.worker.tick();assert.equal(r.allowed,true);assert.equal(r.action,mode);assert.equal(f.models,1);assert.equal(f.deliveries,1);assert.equal(f.state.resources.manualDrafts[0].kind,mode==='share_card'?'dm':'comment');
 }
});

import test from 'node:test';import assert from 'node:assert/strict';
import {freshState,validateState} from '../../src/engine.js';
import {dispatchInteraction,interactionTargetHash,interactionLimits} from '../../src/interaction-gate.js';
const T=1800000000000,intent={kind:'comment',sourceRef:'https://www.douyin.com/video/1234567890123456789',videoId:'1234567890123456789',text:'猫值班，鱼吃饭。'};
function fixture(){let s=freshState();s.paused=false;let sends=0;const store={snapshot:async()=>structuredClone(s),transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}},adapter={inspectTarget:async t=>({ready:true,targetHash:interactionTargetHash(t)}),sendOnce:async t=>{sends++;assert.equal(s.resources.interactionAttempts.at(-1).status,'reserved');return {verified:true,targetHash:interactionTargetHash(t),receiptId:'receipt-1'};}};
 return {store,adapter,state:()=>s,sends:()=>sends,run:extra=>dispatchInteraction({store,adapter,intent,now:()=>T,...extra})};}
test('missing live adapter cannot reserve or send',async()=>{const r=await dispatchInteraction({adapter:null,store:{transact(){throw Error('unexpected');}}});assert.equal(r.reason,'interaction_adapter_unavailable');});
test('target proof mismatch cannot consume budget or trigger a send',async()=>{const f=fixture();f.adapter.inspectTarget=async()=>({ready:true,targetHash:'wrong'});assert.equal((await f.run()).reason,'interaction_target_changed');assert.equal(f.sends(),0);assert.equal(f.state().resources.interactionAttempts,undefined);});
test('durable reservation precedes send and exact receipt confirms it',async()=>{const f=fixture(),r=await f.run();assert.equal(r.status,'confirmed');assert.equal(f.sends(),1);assert.equal(f.state().resources.interactionAttempts[0].status,'confirmed');assert.equal(f.state().resources.interactionAttempts[0].receiptId,'receipt-1');});
test('same intent cannot be resent even after cooldown or restart',async()=>{const f=fixture();await f.run();assert.equal((await f.run({now:()=>T+86400000})).reason,'interaction_duplicate');assert.equal(f.sends(),1);});
test('timeout or missing receipt leaves an unresolved durable attempt and blocks all resends',async()=>{for(const mode of ['throw','unverified']){const f=fixture();f.adapter.sendOnce=async()=>{if(mode==='throw')throw Error('timeout');return {verified:false};};const r=await f.run();assert.equal(r.status,'uncertain');assert.equal(r.retryAllowed,false);const retry=await f.run({intent:{...intent,text:'另一个回复'},now:()=>T+8*86400000});assert.equal(retry.reason,'interaction_result_unresolved');}});
test('zero quota, per-action quota, global cooldown and pause stop dispatch',async()=>{
 for(const limits of [{dailyLimit:0},{commentDailyLimit:0}]){const f=fixture();assert.equal((await f.run({limits})).reason,'interaction_daily_limit');assert.equal(f.sends(),0);}
 const f=fixture();await f.run();assert.equal((await f.run({intent:{...intent,text:'换一条'},now:()=>T+1})).reason,'interaction_cooldown');
 await f.store.transact(s=>{s.paused=true;return {state:s,value:null};});assert.equal((await f.run({intent:{...intent,text:'再换一条'}})).reason,'interaction_paused');
});
test('pending reservation from a crashed process is not reclaimed automatically',async()=>{const f=fixture();await f.run();await f.store.transact(s=>{s.resources.interactionAttempts[0].status='reserved';s.resources.interactionAttempts[0].receiptId=null;return {state:s,value:null};});assert.equal((await f.run({intent:{...intent,text:'另一条'},now:()=>T+8*86400000})).reason,'interaction_result_unresolved');});
test('DM cannot be sent before real identity adapter exists',async()=>{await assert.rejects(fixture().run({intent:{kind:'dm',text:'你好'}}),/inbox identity adapter/);});
test('strict interaction limits reject invented keys and invalid values',()=>{for(const bad of [{dailyLimit:101},{intervalSeconds:-1},{likeDailyLimit:'10'},{sendEnabled:true}])assert.throws(()=>interactionLimits(bad));});
test('owner absence review allows one different manual comment but never the old body or automation',async()=>{
 const f=fixture();f.adapter.sendOnce=async()=>({verified:false});await f.run();
 await f.store.transact(s=>{s.resources.interactionAttempts[0].ownerReportedNotReceived=true;return {state:s,value:null};});
 assert.equal((await f.run({ownerRequested:true,now:()=>T+86400000})).reason,'interaction_result_unresolved');
 assert.equal((await f.run({intent:{...intent,text:'新的手动测试'},now:()=>T+86400000})).reason,'interaction_result_unresolved');
 assert.equal((await f.run({intent:{...intent,text:'新的手动测试'},ownerRequested:true,now:()=>T+86400000})).status,'uncertain');
 assert.equal((await f.run({intent:{...intent,text:'不能反复测试'},ownerRequested:true,now:()=>T+2*86400000})).reason,'interaction_result_unresolved');
});
test('a reviewed absent like requires a fresh adapter proof; its new uncertain attempt blocks another click',async()=>{
 const f=fixture(),like={kind:'like',sourceRef:intent.sourceRef,videoId:intent.videoId};f.adapter.sendOnce=async()=>({verified:false});await f.run({intent:like});
 await f.store.transact(s=>{Object.assign(s.resources.interactionAttempts[0],{ownerReportedNotReceived:true,ownerConfirmedCurrentlyNotLiked:true});return {state:s,value:null};});
 assert.equal((await f.run({intent:like,now:()=>T+86400000})).reason,'interaction_result_unresolved');
 f.adapter.inspectTarget=async()=>({ready:false});assert.equal((await f.run({intent:like,ownerRequested:true,now:()=>T+86400000})).reason,'interaction_target_changed');
 f.adapter.inspectTarget=async t=>({ready:true,targetHash:interactionTargetHash(t)});
 assert.equal((await f.run({intent:like,ownerRequested:true,now:()=>T+86400000})).status,'uncertain');
 assert.equal((await f.run({intent:like,ownerRequested:true,now:()=>T+2*86400000})).reason,'interaction_result_unresolved');
});
test('owner may test a different action kind without retrying an uncertain comment',async()=>{
 const f=fixture();f.adapter.sendOnce=async()=>({verified:false});await f.run();
 const like={kind:'like',sourceRef:intent.sourceRef,videoId:intent.videoId};
 assert.equal((await f.run({intent:like})).reason,'interaction_result_unresolved');
 assert.equal((await f.run({intent:{...intent,text:'另一条'},ownerRequested:true})).reason,'interaction_result_unresolved');
 f.adapter.sendOnce=async t=>({verified:true,targetHash:interactionTargetHash(t),receiptId:'liked'});
 assert.equal((await f.run({intent:like,ownerRequested:true,now:()=>T+600001})).status,'confirmed');
 assert.equal(f.state().resources.interactionAttempts[0].status,'uncertain');
});

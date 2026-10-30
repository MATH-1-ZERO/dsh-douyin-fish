import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshState,validateState,transition} from './engine.js';
import {effectiveSettings} from './persona.js';
import {freshOwnerReplies,ownerIncomingKey,validateOwnerReplies} from './owner-reply-state.js';
import {FishOwnerReplies,ownerReplyDecision,ownerReplyPacing,ownerStopRequested} from './owner-replies.js';
const base=JSON.parse(await readFile(new URL('./settings.json',import.meta.url),'utf8'));
const persona=JSON.parse(await readFile(new URL('./personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
// Explicit scheduling fixture; the distributable defaults to schedule disabled.
persona.schedule.enabled=true;
const owner='verified_owner_123',T=Date.parse('2026-10-24T12:00:00+08:00');
function fixture(){
 let s=freshState(),time=T,reads=0,models=0,sends=0,messages=[],sendResult='confirmed',onGenerate;const sentTexts=[];
 s.paused=false;s.resources.persona=structuredClone(persona);s.resources.persona.ownerId=owner;
 s.resources.ownerIdentity={verified:true,platformId:owner,ownerHandle:'owner_handle'};
 s.resources.development={enabled:true,readsTotal:0,lastReadAt:null};
 s.resources.ownerReplies={...freshOwnerReplies(),enabled:true,ownerId:owner};
 const store={snapshot:async()=>structuredClone(s),transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}};
 const worker=new FishOwnerReplies({store,loadBase:async()=>base,now:()=>time,setTimer:()=>({unref(){}}),clearTimer(){},
 read:async()=>{reads++;return {allowed:true,recipientIdentityVerified:true,checks:{bindingVerified:true,ownBrowserStopped:true,portReleased:true},messages:structuredClone(messages)};},
 generate:async(p,{commit})=>{models++;assert.equal(s.resources.ownerReplies.events.at(-1).status,'reserved');if(onGenerate)return onGenerate(p,{commit});await commit('主人，米饭给小鱼留一口嘛。🐳');},
 send:async(_settings,args,deps)=>{sends++;sentTexts.push(args.text);assert.equal(args.confirm,'send_one_exact_owner_dm');assert.equal(deps.autonomous,true);assert.equal(deps.expectedOwnerId,owner);assert.equal(s.resources.manualDrafts.at(-1).status,'send_uncertain');return {allowed:sendResult==='confirmed',sendAttempted:true,interaction:{status:sendResult,attemptId:'12345678-1234-1234-1234-'+String(sends).padStart(12,'0')}};}});
 const incoming=(text,sender=owner)=>({text,senderId:sender,identityKind:'local_text_fingerprint',localMessageKey:ownerIncomingKey(sender,text)});
 return {worker,store,sentTexts,get state(){return s;},get reads(){return reads;},get models(){return models;},get sends(){return sends;},set outcome(v){sendResult=v;},set onGenerate(fn){onGenerate=fn;},advance(ms=1000){time+=ms;},message(text,sender=owner){messages=[incoming(text,sender)];},messages(texts){messages=texts.map(text=>incoming(text));}};
}

test('bounded startup excludes ordinary start and recovery while the model probe is pending',async()=>{
 const f=fixture();let release;f.worker.generate.probe=()=>new Promise(resolve=>release=resolve);
 const running=f.worker.testRun('test_bounded_verified_owner_replies',{onReady:()=>f.worker.stop()});
 assert.equal((await f.worker.start('start_verified_owner_replies')).reason,'existing_owner_reply_runtime_active');
 assert.equal((await f.worker.resume('recover_owner_replies_after_host_restart')).reason,'existing_owner_reply_runtime_active');
 release();await running;assert.equal(f.sends,0);assert.equal(f.state.paused,true);
});

test('ordinary startup and recovery exclude a bounded test in the opposite race direction',async()=>{
 for(const kind of ['start','resume']){
  const f=fixture();let release;
  if(kind==='start')f.worker.generate.probe=()=>new Promise(resolve=>release=resolve);
  else f.worker.loadBase=()=>new Promise(resolve=>release=()=>resolve(base));
  const starting=kind==='start'?f.worker.start('start_verified_owner_replies',60,{startImmediately:false}):f.worker.resume('recover_owner_replies_after_host_restart');
  assert.equal((await f.worker.testRun('test_bounded_verified_owner_replies')).reason,'existing_owner_reply_runtime_active');
  await f.worker.stop();release();
  assert.equal((await starting).reason,'owner_reply_start_cancelled');
  assert.equal(f.state.paused,true);assert.equal(f.worker.live,false);assert.equal(f.sends,0);
 }
});
test('owner reply baseline does not reply to history; a new message commits one valid draft then sends once',async()=>{
 const f=fixture();f.message('旧消息');assert.equal((await f.worker.tick()).baselineOnly,true);assert.equal(f.models,0);assert.equal(f.sends,0);
 f.advance();f.message('小鱼，米饭好了');const round=await f.worker.tick();assert.equal(round.allowed,true);assert.equal(f.sends,1);assert.equal(f.models,1);
 // A local 'confirmed' ledger row is not proof that the owner actually received it.
 assert.equal(round.report.stages.localReceipt.persisted,true);
 assert.equal(round.report.stages.ownerReceived.verified,false);
 assert.equal(round.report.claims.ownerReceivedConfirmed,false);
 assert.equal(round.ownerReceivedVerified,false);
 assert.equal(f.state.resources.manualDrafts.length,0);
 const event=f.state.resources.ownerReplies.events.at(-1),request=f.state.resources.requests.find(q=>q.id===event.draftId);
 assert.equal(event.status,'confirmed');assert.equal(event.attemptId,round.attemptId);
 assert.equal(f.state.resources.requests.length,1);assert.equal(request.result,null);assert.equal(request.manual.discarded,true);
 assert.equal(f.state.resources.incomingReservations.length,1);
 f.advance();await f.worker.tick();assert.equal(f.models,1);assert.equal(f.sends,1);
 const reloaded=new FishOwnerReplies({store:f.store,loadBase:async()=>base,now:()=>T+3000,generate:async()=>{throw Error('Must not repeat');},read:async()=>({allowed:true,recipientIdentityVerified:true,checks:{bindingVerified:true,ownBrowserStopped:true,portReleased:true},messages:[{text:'小鱼，米饭好了',senderId:owner,identityKind:'local_text_fingerprint',localMessageKey:ownerIncomingKey(owner,'小鱼，米饭好了')}]})});
 assert.equal((await reloaded.status()).resumeRequired,true);assert.equal((await reloaded.tick()).noNewMessage,true);
});
test('uncertain receipt pauses automatic replies and retains uncertain draft instead of resending',async()=>{
 const f=fixture();await f.worker.tick();f.advance();f.message('新文字');f.outcome='uncertain';
 assert.equal((await f.worker.tick()).allowed,false);assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.enabled,false);
 assert.equal(f.state.resources.manualDrafts.at(-1).status,'send_uncertain');
 await f.worker.tick();assert.equal(f.sends,1);
});

test('confirmed automatic reply releases only its temporary text while preserving other work and the send ledger',async()=>{
 const f=fixture();await f.worker.tick();
 const retained=await f.store.transact(s=>{
  const c=effectiveSettings(base,s),prepared=transition(c,s,'manual_prepare',{kind:'dm',material:'保留的手动材料',sourceRef:'manual:unrelated'},T);
  assert.equal(prepared.value.allowed,true);
  return transition(c,prepared.state,'manual_finish',{requestId:prepared.value.requestId,text:'这条独立材料保留。'},T);
 });
 const before=await f.store.snapshot(),send=f.worker.send;
 f.worker.send=async(...args)=>{
  const result=await send(...args);
  await f.store.transact(s=>{s.resources.interactionAttempts=[{id:result.interaction.attemptId,kind:'dm',at:T+300000,key:'a'.repeat(64),status:'confirmed',receiptId:'ui-owner-dm:kept'}];return {state:s,value:null};});
  return result;
 };
 f.advance(300000);f.message('需要自动回复的新消息');const result=await f.worker.tick();
 assert.equal(result.allowed,true);
 assert.deepEqual(f.state.resources.manualDrafts,[retained.draft]);
 assert.deepEqual(f.state.resources.requests.find(q=>q.id===retained.draft.id),before.resources.requests.find(q=>q.id===retained.draft.id));
 assert.equal(f.state.resources.requests.length,2);
 const event=f.state.resources.ownerReplies.events.at(-1),replyRequest=f.state.resources.requests.find(q=>q.id===event.draftId);
 assert.equal(event.status,'confirmed');assert.equal(replyRequest.result,null);assert.equal(replyRequest.manual.discarded,true);
 assert.equal(f.state.resources.ownerReplies.seen.includes(ownerIncomingKey(owner,'需要自动回复的新消息')),true);
 assert.equal(f.state.resources.interactionAttempts[0].id,event.attemptId);
 assert.equal(f.state.resources.interactionAttempts[0].status,'confirmed');
});
test('hidden inbox returns its stage and pauses without automatic retry or any model/send',async()=>{
 const f=fixture();let reads=0;
 const diagnostic={stage:'foreground',pageVisible:false,foregroundAttempted:true,waitMs:3000,openClicked:false};
 f.worker.read=async()=>{reads++;return {allowed:false,reason:'owner_dm_page_hidden',diagnostic};};
 const r=await f.worker.tick();
 assert.equal(r.reason,'owner_dm_page_hidden');assert.deepEqual(r.diagnostic,diagnostic);assert.equal(r.automaticRetryAllowed,false);
 assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.enabled,false);assert.deepEqual(f.state.resources.ownerReplies.lastOutcome.diagnostic,diagnostic);
 await f.worker.tick();assert.equal(reads,1);assert.equal(f.models,0);assert.equal(f.sends,0);
});

test('later inbox failure in a bounded test keeps its diagnostic and no-retry instruction at top level',async()=>{
 const f=fixture();let reads=0;
 const first=f.worker.read,diagnostic={stage:'foreground',ready:false,pageVisible:false,foregroundAttempted:true,waitMs:3000,openClicked:false};
 f.worker.read=async(...args)=>++reads===1?first(...args):{allowed:false,reason:'owner_dm_page_hidden',diagnostic};
 const r=await f.worker.testOnce('test_one_verified_owner_reply',{timeoutSeconds:30,onReady:async()=>{await f.worker.tick();}});
 assert.equal(r.allowed,false);assert.equal(r.reason,'owner_dm_page_hidden');assert.equal(r.automaticRetryAllowed,false);assert.deepEqual(r.diagnostic,diagnostic);
 assert.equal(f.models,0);assert.equal(f.sends,0);assert.equal(reads,2);assert.equal(f.state.paused,true);
});

test('wrong sender or forged local key never reaches model or sender',async()=>{
 const f=fixture();await f.worker.tick();f.message('陌生消息','stranger_123');assert.equal((await f.worker.tick()).reason,'incoming_owner_identity_changed');assert.equal(f.models,0);assert.equal(f.sends,0);
});
test('generation without a validated commit and pause during generation cannot send',async()=>{
 for(const pause of [false,true]){
  const f=fixture();await f.worker.tick();f.advance();f.message('新消息');
  f.onGenerate=async(_p,{commit})=>{if(pause){await f.worker.stop();await assert.rejects(commit('不能发出去'));}return {allowed:true,text:'伪造未保存结果'};};
  // Stop called from outside while a model is active is covered separately;
  // here change the durable switch without waiting on this same cycle.
  if(pause)f.onGenerate=async(_p,{commit})=>{await f.store.transact(s=>{s.paused=true;s.resources.ownerReplies.enabled=false;return {state:s,value:null};});await assert.rejects(commit('不能发出去'));};
  assert.equal((await f.worker.tick()).allowed,false);assert.equal(f.sends,0);
 }
});
test('pending receipt, disabled owner policy and production limits block before any browser read',async()=>{
 const f=fixture();
 await f.store.transact(s=>{s.resources.interactionAttempts=[{id:'12345678-1234-1234-1234-123456789abc',kind:'comment',at:T,key:'a'.repeat(64),status:'uncertain',receiptId:null}];return {state:s,value:null};});
 assert.equal((await f.worker.tick()).reason,'interaction_result_unresolved');assert.equal(f.reads,0);
 assert.equal((await f.worker.start('start_verified_owner_replies')).reason,'interaction_result_unresolved');
});
test('development admission bypasses read quota but preserves sleep, pause and explicit daily-zero disable',()=>{
 const f=fixture(),s=structuredClone(f.state);s.resources.manualBrowserReads=[T-1,T-2,T-3].sort();
 assert.equal(ownerReplyDecision(base,s,T).allowed,true);
 s.resources.persona.schedule.dailyReads=0;assert.equal(ownerReplyDecision(base,s,T).reason,'browser_disabled_by_owner_limit');
 s.resources.persona.schedule.dailyReads=3;assert.equal(ownerReplyDecision(base,s,Date.parse('2026-10-24T23:00:00+08:00')).reason,'sleeping');
 s.paused=true;assert.equal(ownerReplyDecision(base,s,T).reason,'owner_replies_paused');
});
test('corrupt dedup state is refused instead of reset',()=>{
 const r=freshOwnerReplies();validateOwnerReplies(r);r.seen=['a'.repeat(64),'a'.repeat(64)];assert.throws(()=>validateOwnerReplies(r),/Invalid owner reply/);
});

test('one-reply test at night preserves normal schedule and stops after one actual reply',async()=>{
 const f=fixture();f.advance(11*60*60*1000);
 const schedule=structuredClone(f.state.resources.persona.schedule);
 const result=await f.worker.testOnce('test_one_verified_owner_reply',{outsideSchedule:true,onReady:async()=>{
  f.message('小鱼，今晚忙什么呢');f.advance();await f.worker.tick();
 }});
 assert.equal(result.allowed,true);assert.equal(f.sends,1);assert.equal(f.models,1);
 assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.enabled,false);
 assert.deepEqual(f.state.resources.persona.schedule,schedule);
 assert.equal(f.worker.ignoreSchedule,false);
 assert.equal((await f.worker.start('start_verified_owner_replies')).reason,'sleeping');
});

test('one-reply test does not inherit a schedule exception or resend an uncertain reply',async()=>{
 const night=fixture();night.advance(11*60*60*1000);
 assert.equal((await night.worker.testOnce('test_one_verified_owner_reply')).reason,'sleeping');
 assert.equal(night.reads,0);assert.equal(night.sends,0);
 const f=fixture();f.outcome='uncertain';
 const result=await f.worker.testOnce('test_one_verified_owner_reply',{onReady:async()=>{f.message('来一句新的回复');f.advance();await f.worker.tick();}});
 assert.equal(result.allowed,false);assert.equal(f.sends,1);assert.equal(f.state.paused,true);
 assert.equal((await f.worker.testOnce('test_one_verified_owner_reply')).reason,'owner_reply_result_unresolved');
 assert.equal(f.sends,1);
});

test('explicit test resume keeps the same owner baseline and answers a message received while stopped',async()=>{
 const f=fixture();f.message('测试前的旧消息');await f.worker.tick();await f.worker.stop();
 const before=[...f.state.resources.ownerReplies.seen];
 f.advance();f.message('上一轮监听就绪后发出的测试消息');
 const result=await f.worker.testOnce('test_one_verified_owner_reply',{resumeBaseline:true,onReady:async()=>assert.fail('the already received message should be handled immediately')});
 assert.equal(result.allowed,true);assert.equal(result.testCompleted,true);assert.equal(f.sends,1);assert.equal(f.models,1);
 assert.equal(f.state.resources.ownerReplies.seen.length,before.length+1);assert.equal(f.state.paused,true);
});

test('baseline resume refuses missing or different-owner baselines before reading',async()=>{
 for(const mismatch of [false,true]){
  const f=fixture();
  if(mismatch)await f.store.transact(s=>{s.resources.ownerReplies.baselineReady=true;s.resources.ownerReplies.ownerId='another_owner_123';return {state:s,value:null};});
  const result=await f.worker.testOnce('test_one_verified_owner_reply',{resumeBaseline:true});
  assert.equal(result.reason,'matching_owner_reply_baseline_required');assert.equal(f.reads,0);assert.equal(f.sends,0);
 }
});

test('model service errors survive the owner reply wrapper without a send',async()=>{
 const f=fixture();await f.worker.tick();f.advance();f.message('收到的新消息');
 f.onGenerate=async()=>({allowed:false,reason:'model_request_failed',modelRequests:1,failure:{code:'TRANSPORT',message:'provider connection failed'}});
 const result=await f.worker.tick();
 assert.equal(result.reason,'model_request_failed');assert.deepEqual(result.failure,{code:'TRANSPORT',message:'provider connection failed'});
 assert.equal(result.modelRequests,1);assert.equal(f.sends,0);assert.equal(f.state.paused,true);
});

test('a concurrent one-reply test cannot enter during the first model probe',async()=>{
 const f=fixture();let release;
 f.worker.generate.probe=()=>new Promise(resolve=>{release=resolve;});
 const first=f.worker.testOnce('test_one_verified_owner_reply',{onReady:async()=>f.worker.stop()});
 const second=await f.worker.testOnce('test_one_verified_owner_reply');
 assert.equal(second.reason,'existing_owner_reply_runtime_active');release();await first;
 assert.equal(f.sends,0);assert.equal(f.worker.testRunning,false);
});

test('one-reply timeout reports timeout and leaves normal policy paused',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture();
 const result=await f.worker.testOnce('test_one_verified_owner_reply',{timeoutSeconds:30,onReady:async()=>{t.mock.timers.tick(30000);}});
 assert.equal(result.allowed,false);assert.equal(result.reason,'owner_reply_test_timeout');assert.equal(result.testCompleted,false);
 assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.enabled,false);assert.equal(f.sends,0);
});

test('bounded multi-reply test handles two new messages oldest first and stops before a third',async()=>{
 const f=fixture();f.messages(['旧消息二','旧消息一']);
 await f.store.transact(s=>{s.resources.persona.schedule.enabled=false;return {state:s,value:null};});
 const schedule=structuredClone(f.state.resources.persona.schedule),materials=[];
 f.onGenerate=async(p,{commit})=>{const material=JSON.parse(p.payload.untrustedInput).material;materials.push(material);await commit('老大，收到'+material+'。');};
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,onReady:async ready=>{
  assert.equal(ready.maxReplies,2);assert.equal(ready.replyCount,0);
  f.messages(['第二条新消息','第一条新消息','旧消息二']);f.advance();
  assert.equal((await f.worker.tick()).allowed,true);assert.equal(f.worker.live,true);assert.equal(f.state.paused,false);
  // Let the existing contact cooldown elapse; the test does not change policy.
  f.advance(300000);assert.equal((await f.worker.tick()).allowed,true);
  assert.equal(f.worker.live,false);assert.equal(f.state.paused,true);
  f.message('第三条不能自动发');f.advance(300000);
  assert.equal((await f.worker.tick()).reason,'owner_replies_paused');
 }});
 assert.equal(result.allowed,true);assert.equal(result.testCompleted,true);assert.equal(result.reason,'owner_reply_test_limit_reached');
 assert.equal(result.replyCount,2);assert.equal(result.maxReplies,2);assert.equal(result.scope,'at_most_2_replies');assert.equal(result.recipientReadVerified,false);
 assert.deepEqual(materials,['第一条新消息','第二条新消息']);assert.deepEqual(f.sentTexts,['老大，收到第一条新消息。','老大，收到第二条新消息。']);
 assert.equal(new Set(result.replies.map(r=>r.attemptId)).size,2);assert.equal(f.models,2);assert.equal(f.sends,2);
 assert.equal(f.state.resources.manualDrafts.length,0);assert.equal(f.state.resources.ownerReplies.enabled,false);assert.equal(f.state.resources.ownerReplies.inFlightId,null);
 assert.deepEqual(f.state.resources.persona.schedule,schedule);assert.equal(f.worker.testRunning,false);assert.equal(f.worker.ignoreSchedule,false);
});

test('bounded multi-reply test waits on an empty inbox without model calls and times out paused',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,timeoutSeconds:30,onReady:async()=>{
  assert.equal((await f.worker.tick()).noNewMessage,true);assert.equal(f.worker.live,true);
  assert.equal(f.models,0);assert.equal(f.sends,0);t.mock.timers.tick(30000);
 }});
 assert.equal(result.allowed,false);assert.equal(result.testCompleted,false);assert.equal(result.reason,'owner_reply_test_timeout');
 assert.equal(result.replyCount,0);assert.deepEqual(result.replies,[]);assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.enabled,false);
});

test('bounded multi-reply test reports a partial timeout without calling the partial run complete',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const f=fixture();
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:3,timeoutSeconds:30,onReady:async()=>{
  f.message('第一条测试消息');f.advance();await f.worker.tick();
  assert.equal(f.worker.live,true);assert.equal((await f.worker.tick()).noNewMessage,true);t.mock.timers.tick(30000);
 }});
 assert.equal(result.allowed,false);assert.equal(result.testCompleted,false);assert.equal(result.replyCount,1);assert.equal(result.replies[0].deliveryStatus,'confirmed');
 assert.equal(result.reason,'owner_reply_test_timeout');assert.equal(f.models,1);assert.equal(f.sends,1);assert.equal(f.state.paused,true);
});

test('bounded multi-reply test stops on unknown delivery and never tries the next message',async()=>{
 const f=fixture();f.outcome='uncertain';
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,onReady:async()=>{
  f.messages(['第二条测试消息','第一条测试消息']);f.advance();await f.worker.tick();
  assert.equal(f.worker.live,false);f.advance(300000);await f.worker.tick();
 }});
 assert.equal(result.allowed,false);assert.equal(result.testCompleted,false);assert.equal(result.replyCount,0);assert.equal(result.reason,'uncertain');
 assert.equal(result.lastReplyOutcome.deliveryStatus,'uncertain');assert.equal(result.lastReplyOutcome.attemptId,f.state.resources.ownerReplies.events.at(-1).attemptId);
 assert.equal(f.sends,1);assert.equal(f.models,1);assert.equal(f.state.resources.ownerReplies.events.at(-1).status,'uncertain');
 assert.equal((await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2})).reason,'owner_reply_result_unresolved');assert.equal(f.sends,1);
});

test('bounded multi-reply test stops on a later inbox error and retains earlier confirmed results',async()=>{
 const f=fixture(),diagnostic={stage:'close_panel',ready:false,reason:'owner_dm_close_control_occluded'};
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,onReady:async()=>{
  f.message('第一条测试消息');f.advance();await f.worker.tick();
  f.worker.read=async()=>({allowed:false,reason:diagnostic.reason,diagnostic});await f.worker.tick();
 }});
 assert.equal(result.allowed,false);assert.equal(result.testCompleted,false);assert.equal(result.replyCount,1);assert.equal(result.reason,diagnostic.reason);
 assert.deepEqual(result.diagnostic,diagnostic);assert.equal(result.automaticRetryAllowed,false);assert.equal(f.models,1);assert.equal(f.sends,1);assert.equal(f.state.paused,true);
});

test('owner stop in a batch ends the bounded test before any other message is generated',async()=>{
 const f=fixture();
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,onReady:async()=>{
  f.messages(['暂停','需要回复的消息']);f.advance();await f.worker.tick();
 }});
 assert.equal(result.reason,'owner_requested_stop');assert.equal(result.replyCount,0);assert.equal(result.testCompleted,false);assert.equal(f.models,0);assert.equal(f.sends,0);assert.equal(f.state.paused,true);
});

test('tool cancellation ends a bounded multi-reply test without sending or keeping a worker live',async()=>{
 const f=fixture(),controller=new AbortController();
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,signal:controller.signal,onReady:async()=>controller.abort()});
 assert.equal(result.reason,'owner_reply_test_cancelled');assert.equal(result.replyCount,0);assert.equal(result.testCompleted,false);assert.equal(f.state.paused,true);assert.equal(f.worker.live,false);assert.equal(f.sends,0);
});

test('bounded test stops on later admission refusal instead of idling until timeout',async()=>{
 const f=fixture();
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,onReady:async()=>{
  await f.store.transact(s=>{s.resources.ownerIdentity.verified=false;return {state:s,value:null};});
  const next=await f.worker.tick();assert.equal(next.reason,'verified_owner_required');assert.equal(f.worker.live,false);
 }});
 assert.equal(result.reason,'verified_owner_required');assert.equal(result.replyCount,0);assert.equal(f.models,0);assert.equal(f.sends,0);assert.equal(f.state.paused,true);
});

test('bounded test validates the explicit scope and cannot race a single-reply test during its probe',async()=>{
 const f=fixture();assert.equal((await f.worker.testRun('wrong',{maxReplies:2})).reason,'explicit_bounded_owner_reply_test_required');
 for(const maxReplies of [0,1,4,2.5,'2'])await assert.rejects(f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies}),/Invalid bounded/);
 await assert.rejects(f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,timeoutSeconds:601}),/Invalid bounded/);
 assert.equal(f.reads,0);let release;
 f.worker.generate.probe=()=>new Promise(resolve=>{release=resolve;});
 const first=f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,onReady:async()=>f.worker.stop()});
 assert.equal((await f.worker.testOnce('test_one_verified_owner_reply')).reason,'existing_owner_reply_runtime_active');release();
 const result=await first;assert.equal(result.reason,'owner_reply_test_ended_before_limit');assert.equal(result.replyCount,0);assert.equal(f.sends,0);
});
test('a failed final state commit cannot count the last reply or leave the bounded timer running',async()=>{
 const f=fixture(),transact=f.store.transact;let failed=false;
 f.onGenerate=async(p,{commit})=>commit('老大，收到'+JSON.parse(p.payload.untrustedInput).material+'。');
 f.store.transact=fn=>transact(async state=>{
  const next=await fn(state);
  if(!failed&&f.sends===2&&next.state.resources.ownerReplies.events.at(-1)?.status==='confirmed'){
   failed=true;throw Error('simulated atomic state write failure');
  }
  return next;
 });
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,onReady:async()=>{
  f.messages(['第二条','第一条']);f.advance();assert.equal((await f.worker.tick()).allowed,true);
  f.advance(300000);const failedRound=await f.worker.tick();
  assert.equal(failedRound.reason,'owner_reply_state_commit_failed');assert.equal(failedRound.needsStateReview,true);
  assert.equal(f.worker.live,false);assert.equal(f.worker.timer,null);assert.equal(f.worker.testReplies.length,1);
 }});
 assert.equal(failed,true);assert.equal(result.allowed,false);assert.equal(result.testCompleted,false);assert.equal(result.replyCount,1);
 assert.equal(result.reason,'owner_reply_state_commit_failed');assert.equal(result.failure.needsStateReview,true);
 assert.equal(f.models,2);assert.equal(f.sends,2);assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.events.at(-1).status,'uncertain');
 assert.notEqual(f.state.resources.ownerReplies.inFlightId,null);assert.equal(f.worker.testRunning,false);
 await f.worker.tick();assert.equal(f.models,2);assert.equal(f.sends,2);
 assert.equal((await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2})).reason,'owner_replies_busy_or_stale_lease');
});

test('cancelling an in-flight model during the bounded test aborts generation and prevents sending',async()=>{
 const f=fixture(),controller=new AbortController();let reached;const generating=new Promise(resolve=>{reached=resolve;});let calls=0;
 f.worker.generate=async(_prepared,{signal})=>{calls++;reached();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('generation cancelled')),{once:true}));};
 const result=await f.worker.testRun('test_bounded_verified_owner_replies',{maxReplies:2,signal:controller.signal,onReady:async()=>{
  f.message('取消时正在生成的新消息');f.advance();const cycle=f.worker.tick();await generating;controller.abort();await cycle;
 }});
 assert.equal(result.reason,'owner_reply_test_cancelled');assert.equal(result.replyCount,0);assert.equal(result.testCompleted,false);
 assert.equal(calls,1);assert.equal(f.sends,0);assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.inFlightId,null);assert.equal(f.worker.live,false);
});

test('registered bounded tool requires the reply cap and forwards only the bounded options and cancellation',async t=>{
 const calls=[];t.mock.method(FishOwnerReplies.prototype,'testRun',async(confirm,options)=>{calls.push({confirm,options});return {allowed:false,reason:'registration_only'};});
 const tools=new Map(),{apply}=await import('./index.js');apply({tools:{register:t=>tools.set(t.name,t)}});
 const tool=tools.get('fish_owner_replies_test_run');assert.ok(tool);assert.deepEqual(tool.parameters.required,['confirm','maxReplies']);
 assert.equal(tool.parameters.properties.maxReplies.minimum,2);assert.equal(tool.parameters.properties.maxReplies.maximum,3);assert.equal(tool.parameters.properties.timeoutSeconds.maximum,600);
 await assert.rejects(tool.execute({confirm:'test_bounded_verified_owner_replies'}),/Invalid tool arguments/);
 await assert.rejects(tool.execute({confirm:'test_bounded_verified_owner_replies',maxReplies:2,recipientId:'stranger'}),/Invalid tool arguments/);
 assert.equal((await tool.execute({confirm:'wrong',maxReplies:2})).reason,'explicit_bounded_owner_reply_test_required');assert.equal(calls.length,0);
 const controller=new AbortController();await tool.execute({confirm:'test_bounded_verified_owner_replies',maxReplies:2},{signal:controller.signal});
 assert.deepEqual(calls[0],{confirm:'test_bounded_verified_owner_replies',options:{maxReplies:2,resumeBaseline:false,outsideSchedule:false,timeoutSeconds:300,signal:controller.signal}});
 controller.abort();await assert.rejects(tool.execute({confirm:'test_bounded_verified_owner_replies',maxReplies:2},{signal:controller.signal}),/Cancelled/);assert.equal(calls.length,1);
});

test('stopping an in-flight read aborts it and waits for cleanup before returning',async()=>{
 const f=fixture();let ready;const opened=new Promise(resolve=>{ready=resolve;});
 f.worker.read=async(_s,_a,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});ready();});
 const cycle=f.worker.tick();await opened;await f.worker.stop();await cycle;
 assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.inFlightId,null);assert.equal(f.sends,0);assert.equal(f.models,0);
});
test('a send exception leaves its draft uncertain and cannot be resumed without review',async()=>{
 const f=fixture();await f.worker.tick();f.advance();f.message('新的测试消息');f.worker.send=async()=>{throw Error('connection lost');};
 await f.worker.tick();assert.equal(f.state.resources.manualDrafts.at(-1).status,'send_uncertain');
 assert.equal((await f.worker.start('start_verified_owner_replies')).reason,'owner_reply_result_unresolved');
});
test('owner interaction pacing defers a reply instead of pausing the worker',async()=>{
 const f=fixture();
 await f.store.transact(s=>{s.resources.development={enabled:false,readsTotal:0,lastReadAt:null};
  s.resources.interactionAttempts=[{id:'12345678-1234-1234-1234-123456789abc',kind:'dm',at:T-1000,key:'a'.repeat(64),status:'confirmed',receiptId:'ui-owner-dm:1'}];return {state:s,value:null};});
 await f.worker.tick();f.advance();f.message('小鱼，来看一眼');
 const round=await f.worker.tick();
 assert.equal(round.deferred,true);assert.equal(String(round.reason).startsWith('owner_reply_deferred:'),true);
 assert.equal(f.reads,0);assert.equal(f.models,0);assert.equal(f.sends,0);
 assert.equal(f.state.paused,false);assert.equal(f.state.resources.ownerReplies.enabled,true);
 // The message stays unseen so it can still be answered after the window opens.
 assert.equal(f.state.resources.ownerReplies.seen.includes('x'),false);
 assert.equal(ownerReplyPacing(base,f.state,T+601000).allowed,true);
});
test('a late pacing refusal keeps the worker live and leaves the draft unsent for a retry',async()=>{
 const f=fixture();await f.worker.tick();f.advance();f.message('小鱼，第二碗饭');
 f.worker.send=async()=>({allowed:false,reason:'interaction_cooldown',sendAttempted:false});
 const round=await f.worker.tick();
 assert.equal(round.deferred,true);assert.equal(round.reason,'owner_reply_deferred:interaction_cooldown');
 assert.equal(f.state.paused,false);assert.equal(f.state.resources.ownerReplies.enabled,true);
 assert.equal(f.state.resources.manualDrafts.at(-1).status,'copy_only_unsent');
 assert.equal(f.state.resources.ownerReplies.events.at(-1).status,'deferred');
 assert.equal(f.state.resources.ownerReplies.events.at(-1).reason,'deferred_by_owner_limits');
 assert.equal(f.state.resources.ownerReplies.inFlightId,null);
});
test('a deferred reply is retried from its saved draft without a new model call',async()=>{
 const f=fixture();await f.worker.tick();f.advance();f.message('小鱼，第二碗饭');
 let sendCalls=0;
 f.worker.send=async()=>{sendCalls++;return {allowed:false,reason:'interaction_cooldown',sendAttempted:false};};
 await f.worker.tick();
 assert.equal(f.state.resources.ownerReplies.events.at(-1).status,'deferred');
 f.advance();f.message('小鱼，先别急');
 const texts=[];f.worker.send=async(_s,args)=>{sendCalls++;texts.push(args.text);return {allowed:true,sendAttempted:true,interaction:{status:'confirmed',attemptId:'12345678-1234-1234-1234-123456789abc'}};};
 const round=await f.worker.tick();
 assert.equal(round.allowed,true);assert.equal(round.retriedSavedDraft,true);
 assert.equal(round.report.stages.model.called,false);assert.equal(round.report.stages.model.outcome,'reused_saved_draft');
 assert.equal(texts.length,1);assert.equal(texts[0],'主人，米饭给小鱼留一口嘛。🐳');
 assert.equal(f.models,1);assert.equal(sendCalls,2);
 assert.equal(f.state.resources.ownerReplies.events.at(-1).status,'confirmed');
 assert.equal(f.state.resources.manualDrafts.length,0);
 assert.equal(f.state.resources.requests.find(q=>q.id===f.state.resources.ownerReplies.events.at(-1).draftId).result,null);
 // The newer message stays unseen; inside the contact cooldown it is deferred
 // before any model call instead of pausing the worker.
 assert.equal(f.state.resources.ownerReplies.seen.includes(ownerIncomingKey(owner,'小鱼，先别急')),false);
 f.advance();
 const paced=await f.worker.tick();
 assert.equal(paced.deferred,true);assert.equal(paced.reason,'owner_reply_deferred:contact_cooldown');
 assert.equal(f.models,1);assert.equal(sendCalls,2);assert.equal(f.state.paused,false);
 f.advance(300000);
 const next=await f.worker.tick();
 assert.equal(next.allowed,true);assert.equal(f.models,2);assert.equal(sendCalls,3);
 assert.equal(f.state.resources.manualDrafts.length,0);
 assert.ok(f.state.resources.ownerReplies.events.every(e=>e.status==='confirmed'));
});
test('a retry that is deferred again stays deferred and keeps the worker live',async()=>{
 const f=fixture();await f.worker.tick();f.advance();f.message('小鱼，第二碗饭');
 f.worker.send=async()=>({allowed:false,reason:'interaction_cooldown',sendAttempted:false});
 await f.worker.tick();
 f.advance();
 const again=await f.worker.tick();
 assert.equal(again.deferred,true);assert.equal(again.retriedSavedDraft,true);assert.equal(again.reason,'owner_reply_deferred:interaction_cooldown');
 assert.equal(f.state.paused,false);assert.equal(f.state.resources.ownerReplies.enabled,true);
 assert.equal(f.state.resources.ownerReplies.events.at(-1).status,'deferred');
 assert.equal(f.state.resources.manualDrafts.at(-1).status,'copy_only_unsent');
 assert.equal(f.state.resources.ownerReplies.inFlightId,null);
 assert.equal(f.models,1);
});
test('a stop phrase pauses before a deferred reply is retried',async()=>{
 const f=fixture();await f.worker.tick();f.advance();f.message('小鱼，第二碗饭');
 let sendCalls=0;
 f.worker.send=async()=>{sendCalls++;return {allowed:false,reason:'interaction_cooldown',sendAttempted:false};};
 await f.worker.tick();
 f.advance();f.message('别回了');
 const round=await f.worker.tick();
 assert.equal(round.reason,'owner_requested_stop');assert.equal(sendCalls,1);assert.equal(f.models,1);
 assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.enabled,false);
 assert.equal(f.state.resources.manualDrafts.at(-1).status,'copy_only_unsent');
 assert.equal(f.state.resources.ownerReplies.events.find(e=>e.status==='deferred')?.reason,'deferred_by_owner_limits');
});
test('a stop phrase in owner text only pauses and never reaches model or sender',async()=>{
 const f=fixture();await f.worker.tick();f.advance();f.message('别回了');
 assert.equal((await f.worker.tick()).reason,'owner_requested_stop');
 assert.equal(f.models,0);assert.equal(f.sends,0);
 assert.equal(f.state.paused,true);assert.equal(f.state.resources.ownerReplies.enabled,false);
 assert.equal(f.state.resources.ownerReplies.events.at(-1).status,'skipped');
 assert.equal(f.state.resources.ownerReplies.events.at(-1).reason,'owner_message_requested_stop');
 assert.equal(ownerStopRequested('别回了'),true);assert.equal(ownerStopRequested('别回了啊'),false);assert.equal(ownerStopRequested('在吗'),false);
});
test('host restart recovery clears only a stale reply lease and needs the explicit confirmation',async()=>{
 const f=fixture();
 // Test the recovery transaction separately from the new background cycle.
 f.worker.tick=async()=>({allowed:true,noNewMessage:true});
 assert.equal((await f.worker.resume('recover')).reason,'explicit_owner_replies_recover_required');
 const stale=async ageMs=>{await f.store.transact(s=>{const r=s.resources.ownerReplies;r.inFlightId='99999999-9999-4999-8999-199999999999';r.inFlightAt=T-ageMs;r.inFlightId&&r.events.push({key:'a'.repeat(64),at:T-ageMs,status:'reserved'});return {state:s,value:null};});return f.worker.resume('recover_owner_replies_after_host_restart');};
 const fresh=await stale(5*60*1000);
 assert.equal(fresh.allowed,false);assert.equal(fresh.reason,'owner_replies_busy_or_stale_lease');
 const recovered=await stale(20*60*1000);
 assert.equal(recovered.allowed,true);assert.equal(recovered.leaseCleared,true);
 assert.equal(f.state.resources.ownerReplies.inFlightId,null);assert.equal(f.state.resources.ownerReplies.inFlightAt,null);
 assert.equal(f.state.paused,false);assert.equal(f.state.resources.ownerReplies.enabled,true);
 assert.equal(f.state.resources.ownerReplies.events.find(e=>e.status==='reserved'),undefined);
 assert.equal(f.state.resources.ownerReplies.events.at(-1).reason,'lease_cleared_after_host_restart');
 assert.equal(f.state.resources.ownerReplies.lastOutcome.reason,'stale_lease_cleared_after_host_restart');
 await f.worker.stop();
 const off=fixture();
 await off.store.transact(s=>{s.resources.ownerReplies.enabled=false;return {state:s,value:null};});
 assert.equal((await off.worker.resume('recover_owner_replies_after_host_restart')).reason,'owner_replies_not_enabled');
});

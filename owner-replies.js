import {randomUUID} from 'node:crypto';
import {freshOwnerReplies,ownerIncomingKey} from './owner-reply-state.js';
import {effectiveSettings} from './persona.js';
import {admission,freshAutonomy,MAX_LEASE_AGE_MS} from './autonomy.js';
import {interactionLimits} from './interaction-gate.js';
import {ownerLimitDefaults} from './owner-limits.js';
import {incomingCommand} from './incoming.js';
import {transition} from './engine.js';
import {readOwnerInbox,sendOwnerDm} from './owner-dm.js';
import {verifiedBrowserLifecycle} from './browser-lifecycle.js';
import {reserveBrowserWorkflow} from './browser-workflow.js';
import {isBlockingAttempt} from './attempt-review.js';
import {deliveryReport} from './delivery-report.js';
import {manualCommand} from './manual.js';

export function ownerReplyDecision(base,state,time,{ignoreSchedule=false}={}){
 const r=state.resources.ownerReplies??freshOwnerReplies(),owner=state.resources.ownerIdentity;
 const deny=reason=>({allowed:false,reason});
 if(!r.enabled||state.paused)return deny('owner_replies_paused');
 if(r.inFlightId)return deny('owner_replies_busy_or_stale_lease');
 if(r.events.some(e=>['reserved','uncertain'].includes(e.status)))return deny('owner_reply_result_unresolved');
 if(owner?.verified!==true||owner.platformId!==r.ownerId||state.resources.persona?.ownerId!==r.ownerId)return deny('verified_owner_required');
 if(state.resources.autonomy?.enabled)return deny('other_worker_active');
 if((state.resources.interactionAttempts??[]).some(isBlockingAttempt))return deny('interaction_result_unresolved');
 if(r.seen.length>=500||r.events.length>=200)return deny('owner_reply_history_full');
 const c=effectiveSettings(base,state);
 if(!c.inboundPolicy?.allowOwner)return deny('owner_dm_disabled_by_policy');
 const copy=structuredClone(state);
 copy.resources.autonomy={...freshAutonomy(),enabled:true,sessionStart:r.sessionStart,restUntil:r.restUntil};
 const decision=admission(base,copy,time,{ignoreSchedule});
 // Retain the schedule's session/rest transitions independently of browsing.
 r.sessionStart=copy.resources.autonomy.sessionStart;r.restUntil=copy.resources.autonomy.restUntil;
 return decision;
}

// The owner's message text stays untrusted: a stop phrase can only ever reduce
// activity (pause the worker), never grant tools, recipients or settings.
export function ownerStopRequested(text){
 const t=String(text??'').replace(/[\s。！!？?，,、~～.]+$/u,'').trim();
 return t.length>0&&t.length<=12&&/^(?:停|停一下|先停|停下|停下来|别回了|不要回了|别回复了|不用回了|先别回了|别再回了|暂停|暂停一下|先暂停|别发了|先别发了)$/u.test(t);
}
const paceReasons=new Set(['interaction_cooldown','dm_contact_cooldown','interaction_daily_limit','dm_contact_daily_limit']);
const DAY_MS=86400000;
// Cheap pre-check before any read or model call: a reply that the interaction
// ledger would refuse for pacing is deferred instead of pausing the worker.
export function ownerReplyPacing(base,state,time){
 if(state.resources?.development?.enabled)return {allowed:true};
 const limits=interactionLimits({...interactionLimits(base?.interactionLimits),...state.resources?.persona?.interactionLimits});
 const p={...ownerLimitDefaults,...state.resources?.persona?.limits};
 const recent=(state.resources?.interactionAttempts??[]).filter(q=>q.kind==='dm'&&q.status!=='not_applied'&&time>=q.at&&time-q.at<DAY_MS);
 const last=recent.reduce((m,q)=>Math.max(m,q.at),0);
 if(recent.length>=p.dmDailyLimitPerContact)return {allowed:false,reason:'dm_contact_daily_limit_reached'};
 if(recent.length>=limits.dmDailyLimit)return {allowed:false,reason:'dm_daily_limit_reached'};
 if(recent.length>=limits.dailyLimit)return {allowed:false,reason:'interaction_daily_limit_reached'};
 const wait=last?Math.max(limits.intervalSeconds*1000-(time-last),p.dmIntervalSeconds*1000-(time-last)):0;
 if(wait>0)return {allowed:false,reason:'dm_cooldown_active',retryAfterMs:wait};
 return {allowed:true};
}

export class FishOwnerReplies{
 #startup=null;
 constructor({store,loadBase,generate,read=readOwnerInbox,send=sendOwnerDm,now=Date.now,setTimer=setInterval,clearTimer=clearInterval}){
  Object.assign(this,{store,loadBase,generate,read,send,now,setTimer,clearTimer});this.live=false;this.active=null;this.timer=null;this.controller=null;
 }
 async start(confirm,pollSeconds=60,{singleReplyTest=false,ignoreSchedule=false,resumeBaseline=false,startImmediately=true}={}){
  if(this.testRunning||this.#startup)return {allowed:false,reason:'existing_owner_reply_runtime_active'};
  return this.#starting(token=>this.#start(confirm,pollSeconds,{singleReplyTest,ignoreSchedule,resumeBaseline,startImmediately},token));
 }
 async #starting(operation){
  const token={cancelled:false};this.#startup=token;
  try{return await operation(token);}finally{if(this.#startup===token)this.#startup=null;}
 }
 async #start(confirm,pollSeconds,{singleReplyTest=false,ignoreSchedule=false,resumeBaseline=false,startImmediately=true},token){
  if(confirm!=='start_verified_owner_replies')return {allowed:false,reason:'explicit_owner_replies_start_required'};
  if(!Number.isSafeInteger(pollSeconds)||pollSeconds<15||pollSeconds>3600)throw Error('Invalid owner inbox polling interval');
  if(typeof this.generate!=='function')return {allowed:false,reason:'DSH_agent_runtime_unavailable'};
  if(typeof this.generate.probe==='function'){try{await this.generate.probe();}catch(e){return {allowed:false,reason:'agent_bridge_probe_failed',error:e.message};}}
  if(token.cancelled)return {allowed:false,reason:'owner_reply_start_cancelled'};
  if(this.live)return {allowed:true,alreadyRunning:true};
  const base=await this.loadBase();
  if(token.cancelled)return {allowed:false,reason:'owner_reply_start_cancelled'};
  const result=await this.store.transact(s=>{
   if(token.cancelled)return {state:s,value:{allowed:false,reason:'owner_reply_start_cancelled'}};
   const r=s.resources.ownerReplies??=freshOwnerReplies();
   if(r.inFlightId)return {state:s,value:{allowed:false,reason:'owner_replies_busy_or_stale_lease'}};
   if(resumeBaseline&&(!singleReplyTest||!r.baselineReady||r.ownerId!==s.resources.ownerIdentity?.platformId||r.ownerId!==s.resources.persona?.ownerId))return {state:s,value:{allowed:false,reason:'matching_owner_reply_baseline_required'}};
   const probe=structuredClone(s);probe.paused=false;
   Object.assign(probe.resources.ownerReplies,{enabled:true,ownerId:s.resources.ownerIdentity?.platformId??null});
   const next=ownerReplyDecision(base,probe,this.now(),{ignoreSchedule:singleReplyTest&&ignoreSchedule});
   if(!next.allowed)return {state:s,value:next};
   Object.assign(r,{enabled:true,ownerId:probe.resources.ownerReplies.ownerId,pollSeconds,baselineReady:resumeBaseline,sessionStart:null,restUntil:null});s.paused=false;
   return {state:s,value:{allowed:true,scope:'verified_owner_only',baselineWillSkipExistingMessages:!resumeBaseline,resumedBaseline:resumeBaseline,pollSeconds}};
  });
  if(!result.allowed)return result;
  if(token.cancelled){await this.stop();return {allowed:false,reason:'owner_reply_start_cancelled'};}
  this.testMode=singleReplyTest;this.ignoreSchedule=singleReplyTest&&ignoreSchedule;
  this.live=true;this.timer=this.setTimer(()=>{void this.tick().catch(()=>{});},pollSeconds*1000);this.timer?.unref?.();
  if(startImmediately)void this.tick().catch(()=>{});return result;
 }
 tick(){if(this.active)return this.active;this.active=this.cycle().finally(()=>{this.active=null;});return this.active;}
 async cycle(){
  const base=await this.loadBase();
  const pacing=ownerReplyPacing(base,await this.store.snapshot(),this.now());
  if(!pacing.allowed)return {allowed:true,deferred:true,reason:'owner_reply_deferred:'+pacing.reason,retryAfterMs:pacing.retryAfterMs??null};
  const claim=await this.store.transact(s=>{
   const next=ownerReplyDecision(base,s,this.now(),{ignoreSchedule:this.testMode===true&&this.ignoreSchedule===true}),r=s.resources.ownerReplies;
   if(next.allowed){r.inFlightId=randomUUID();r.inFlightAt=this.now();r.sessionStart??=this.now();}
   return {state:s,value:{...next,id:r?.inFlightId,ownerId:r?.ownerId}};
  });
  if(!claim.allowed){
   // A bounded test must not remain live after a later admission failure.
   // Do not clear another lease or retry a partially processed message.
   if(this.testMode&&this.live){
    this.live=false;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;
    await this.store.transact(s=>{s.paused=true;const r=s.resources.ownerReplies;if(r){r.enabled=false;r.lastOutcome={at:this.now(),allowed:false,reason:claim.reason};}return {state:s,value:null};});
   }
   return claim;
  }
  this.controller=new AbortController();const signal=this.controller.signal;
  let outcome={allowed:false,reason:'owner_reply_interrupted'},messageKey;
  const stillAllowed=s=>!signal.aborted&&!s.paused&&s.resources.ownerReplies?.enabled&&s.resources.ownerReplies.inFlightId===claim.id&&s.resources.ownerIdentity?.verified===true&&s.resources.ownerIdentity.platformId===claim.ownerId&&s.resources.persona?.ownerId===claim.ownerId;
  try{
   const settings=effectiveSettings(base,await this.store.snapshot());
   let browserWorkflow;
   if(this.read===readOwnerInbox){const reserved=await reserveBrowserWorkflow(settings,this.store,{stages:2,now:this.now()});if(!reserved.allowed)throw Error(reserved.reason);browserWorkflow=reserved.ticket;}
   const attemptSend=async(text,retry)=>{
    const sent=await this.send(effectiveSettings(await this.loadBase(),await this.store.snapshot()),{confirm:'send_one_exact_owner_dm',text},{store:this.store,signal,autonomous:true,expectedOwnerId:claim.ownerId,browserWorkflow});
    const attempted=!!sent.interaction?.attemptId;
    // Owner pacing limits are not a failure: keep the worker alive, keep the
    // draft unsent, and retry it from the saved draft once the window opens.
    if(!sent.allowed&&paceReasons.has(sent.reason)){outcome={allowed:true,deferred:true,reason:'owner_reply_deferred:'+sent.reason,deferredReason:sent.reason,sendingPerformed:false,
      note:'Owner interaction limits deferred this reply; the draft stays unsent and a later cycle retries it without a new model call.'};return outcome;}
    outcome={allowed:sent.allowed===true&&sent.interaction?.status==='confirmed',reason:sent.reason??sent.interaction?.status??'owner_send_not_verified',attemptId:sent.interaction?.attemptId,deliveryStatus:sent.interaction?.status==='confirmed'?'confirmed':sent.sendAttempted===false?'not_sent':'uncertain',
     report:deliveryReport(await this.store.snapshot(),retry?
      {model:{called:false,requests:0,action:'dm',status:'reused_saved_draft'},action:{kind:'dm',attempted,target:'verified_owner_conversation',error:sent.reason??null},receipt:{status:sent.interaction?.status??'not_recorded'},attemptId:sent.interaction?.attemptId}:
      {read:{allowed:true,untrustedMaterial:{sourceRef:'https://www.douyin.com/user/'+claim.ownerId,text:''},checks:{bindingVerified:true}},
       model:{called:true,requests:1,action:'dm',status:'draft_sent'},
       action:{kind:'dm',attempted,target:'verified_owner_conversation',error:sent.reason??null},
       receipt:{status:sent.interaction?.status??'not_recorded'},attemptId:sent.interaction?.attemptId})};
    outcome.ownerReceivedVerified=outcome.report.stages.ownerReceived.verified;
    return outcome;
   };
   const inbox=await this.read(settings,{confirm:'read_verified_owner_inbox',maxMessages:3},{store:this.store,signal,browserWorkflow});
   if(!inbox.allowed||inbox.recipientIdentityVerified!==true||!verifiedBrowserLifecycle(inbox.checks)){
    outcome={allowed:false,reason:inbox.reason||'owner_inbox_not_verified',diagnostic:inbox.diagnostic,automaticRetryAllowed:false,sendingPerformed:false,
     instruction:'This worker stops on an inbox failure. Do not repeat the test automatically. owner_dm_page_hidden describes document visibility, not login or captcha; a hidden iframe and absence of a /message tab do not prove a restriction.'};
    return outcome;
   }
   const messages=inbox.messages??[];
   if(messages.some(m=>m.senderId!==claim.ownerId||m.identityKind!=='local_text_fingerprint'||typeof m.text!=='string'||!m.text.trim()||m.text.length>300||ownerIncomingKey(m.senderId,m.text)!==m.localMessageKey))throw Error('incoming_owner_identity_changed');
   const prepared=await this.store.transact(s=>{
    if(!stillAllowed(s))return {state:s,value:{allowed:false,reason:'owner_replies_paused'}};
    const r=s.resources.ownerReplies,keys=messages.map(m=>m.localMessageKey);
    if(!r.baselineReady){
     if(new Set([...r.seen,...keys]).size>500)throw Error('owner_reply_history_full');
     r.seen=[...new Set([...r.seen,...keys])];r.baselineReady=true;
     return {state:s,value:{allowed:true,baselineOnly:true,existingSkipped:keys.length}};
    }
    // A stop phrase from the owner pauses before anything is retried or sent;
    // it only ever reduces activity and never grants anything.
    const stop=messages.find(m=>!r.seen.includes(m.localMessageKey)&&ownerStopRequested(m.text));
    if(stop){
     r.seen.push(stop.localMessageKey);r.events.push({key:stop.localMessageKey,at:this.now(),status:'skipped',reason:'owner_message_requested_stop'});
     r.enabled=false;s.paused=true;
     return {state:s,value:{allowed:false,reason:'owner_requested_stop',stopRequested:true,modelSkipped:true,sendingPerformed:false,
       note:'The owner text looked like a stop request; it only ever pauses, and never grants anything.'}};
    }
    // A reply deferred by owner limits is retried from its saved draft before
    // any new message is answered: it was never attempted (no attemptId), so
    // one more bounded send try is safe, with no new model call.
    const deferred=r.events.map(e=>{if(e.status!=='deferred'||typeof e.draftId!=='string'||e.attemptId)return null;const d=s.resources.manualDrafts.find(d=>d.id===e.draftId);return d&&d.status==='copy_only_unsent'&&typeof d.text==='string'&&d.text.trim()?{event:e,draft:d}:null;}).find(Boolean)??null;
    if(deferred){
     if(r.seen.length>=500||r.events.length>=200)throw Error('owner_reply_history_full');
     deferred.draft.status='send_uncertain';deferred.event.status='uncertain';
     return {state:s,value:{allowed:true,retrySavedDraft:true,text:deferred.draft.text,messageKey:deferred.event.key}};
    }
    // Observations are newest-first; handle one previously unseen message per cycle.
    const m=[...messages].reverse().find(m=>!r.seen.includes(m.localMessageKey));
    if(!m)return {state:s,value:{allowed:true,noNewMessage:true}};
    if(r.seen.length>=500||r.events.length>=200)throw Error('owner_reply_history_full');
    messageKey=m.localMessageKey;r.seen.push(messageKey);r.events.push({key:messageKey,at:this.now(),status:'reserved'});
    // This reservation is durable before any model call. Message text never
    // grants tools, recipient access, settings changes or a new worker start.
    const probe=incomingCommand(base,s,'incoming_prepare',{kind:'dm',senderId:claim.ownerId,messageId:'local:'+messageKey,text:m.text},this.now());
    if(!probe.value.allowed&&['contact_cooldown','contact_daily_limit'].includes(probe.value.reason)){
     // Contact pacing is not a failure: leave the message unseen for a later
     // cycle and drop the reservation created just now in this same cycle.
     if(probe.value.incomingKey)s.resources.incomingPrepared=s.resources.incomingPrepared.filter(k=>k!==probe.value.incomingKey);
     r.seen=r.seen.filter(k=>k!==messageKey);r.events.pop();messageKey=undefined;
     return {state:s,value:{allowed:true,deferredPrepare:true,reason:'owner_reply_deferred:'+probe.value.reason,deferredReason:probe.value.reason}};
    }
    return probe;
   });
   if(prepared.baselineOnly||prepared.noNewMessage||prepared.stopRequested){outcome=prepared;return outcome;}
   if(prepared.deferredPrepare){outcome={allowed:true,deferred:true,reason:prepared.reason,deferredReason:prepared.deferredReason,sendingPerformed:false,
     note:'Owner contact pacing deferred this message before any model call; it stays unseen for a later cycle.'};return outcome;}
   if(prepared.retrySavedDraft){
    messageKey=prepared.messageKey;
    await attemptSend(prepared.text,true);
    outcome.retriedSavedDraft=true;
    return outcome;
   }
   if(!prepared.allowed||prepared.cacheHit){outcome={allowed:false,reason:prepared.reason??'cached_draft_not_automatically_sent'};return outcome;}
   let draft;
   const generation=await this.generate(prepared,{signal,commit:async text=>this.store.transact(s=>{
    if(!stillAllowed(s))throw Error('owner_replies_paused');
    const r=transition(effectiveSettings(base,s),s,'manual_finish',{requestId:prepared.requestId,text},this.now());
    if(r.value.allowed){draft=r.value.draft;Object.assign(r.state.resources.ownerReplies.events.find(e=>e.key===messageKey),{status:'draft_saved',draftId:draft.id});}
    return r;
   })});
   if(!draft){outcome={allowed:false,reason:generation?.reason??'model_did_not_save_valid_draft',modelRequests:generation?.modelRequests??0,...(generation?.failure?{failure:generation.failure}:{})};return outcome;}
   const current=await this.store.snapshot();if(!stillAllowed(current))throw Error('owner_replies_paused');
   await this.store.transact(s=>{
    if(!stillAllowed(s))throw Error('owner_replies_paused');
    const saved=s.resources.manualDrafts.find(d=>d.id===draft.id);if(!saved)throw Error('owner_reply_draft_missing');
    saved.status='send_uncertain';s.resources.ownerReplies.events.find(e=>e.key===messageKey).status='uncertain';
    return {state:s,value:null};
   });
   await attemptSend(draft.text,false);
   return outcome;
  }catch(error){outcome={allowed:false,reason:String(error.message||'owner_reply_failed').slice(0,160)};return outcome;}
  finally{
   this.controller=null;
   const testReply=this.testMode&&messageKey&&!outcome.deferred;
   const confirmedTestReply=testReply&&outcome.allowed===true&&outcome.deliveryStatus==='confirmed';
   const testLimitReached=confirmedTestReply&&(this.testReplies?.length??0)+1>=(this.testMaxReplies??1);
   const stopAfterCycle=!outcome.allowed||testLimitReached;
   try{await this.store.transact(s=>{
    const r=s.resources.ownerReplies;
    if(r?.inFlightId!==claim.id)throw Error('Owner reply lease changed before final commit');
    if(r?.inFlightId===claim.id){
     const e=r.events.find(e=>e.key===messageKey);
     if(e){
      if(outcome.deferred){e.status='deferred';e.reason='deferred_by_owner_limits';}
      else e.status=outcome.deliveryStatus==='confirmed'?'confirmed':outcome.deliveryStatus==='uncertain'||e.status==='uncertain'&&outcome.deliveryStatus!=='not_sent'?'uncertain':e.draftId?'failed':'skipped';
      if(outcome.attemptId)e.attemptId=outcome.attemptId;
      const draft=s.resources.manualDrafts.find(d=>d.id===e.draftId);
      if(draft&&e.status==='confirmed')draft.status='confirmed_sent';
      if(draft&&outcome.attemptId)draft.deliveryAttemptId=outcome.attemptId;
      if(draft&&(outcome.deliveryStatus==='not_sent'||outcome.deferred))draft.status='copy_only_unsent';
      // A completed automatic reply no longer needs a queued text record.
      // Keep its request reservation, incoming dedup, event and send ledger;
      // discard only this reply and its cached result, with no budget refund.
      if(e.status==='confirmed'&&e.draftId)manualCommand(effectiveSettings(base,s),s,'manual_discard',{id:e.draftId},this.now());
     }
     r.inFlightId=null;r.inFlightAt=null;r.lastOutcome={at:this.now(),allowed:outcome.allowed===true,reason:String(outcome.reason??(outcome.baselineOnly?'baseline_saved':'no_new_message')).slice(0,160),...(outcome.diagnostic?{diagnostic:outcome.diagnostic}:{})};
     // Empty inbox/baseline are normal. All processing or identity failures
     // pause the worker instead of silently retrying a model call or send.
     if(stopAfterCycle){r.enabled=false;s.paused=true;}
    }
    return {state:s,value:null};
   });}catch(error){
    // A visible send is not a completed test until its bookkeeping is durable.
    // Keep any unresolved persisted event/lease for review and stop locally;
    // the timer must never retry after a failed final commit.
    this.live=false;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;
    const failure={allowed:false,reason:'owner_reply_state_commit_failed',error:String(error.message||'state commit failed').slice(0,160),attemptId:outcome.attemptId,automaticRetryAllowed:false,needsStateReview:true};
    if(this.testMode){this.testFailure=failure;this.testOutcome=failure;}
    return failure;
   }
   if(testReply)this.testOutcome=outcome;
   if(confirmedTestReply){this.testReplies??=[];this.testReplies.push(outcome);}
   if(stopAfterCycle){this.live=false;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;}
  }
 }
 async stop(){
  if(this.#startup)this.#startup.cancelled=true;
  this.live=false;if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;this.controller?.abort();
  await this.store.transact(s=>{s.paused=true;if(s.resources.ownerReplies)s.resources.ownerReplies.enabled=false;return {state:s,value:null};});
  if(this.active)await this.active;return {paused:true,ownerRepliesEnabled:false};
 }
 async testOnce(confirm,{outsideSchedule=false,resumeBaseline=false,timeoutSeconds=180,onReady=async()=>{},signal}={}){
  if(confirm!=='test_one_verified_owner_reply')return {allowed:false,reason:'explicit_owner_reply_test_required'};
  if(typeof outsideSchedule!=='boolean'||typeof resumeBaseline!=='boolean'||!Number.isSafeInteger(timeoutSeconds)||timeoutSeconds<30||timeoutSeconds>300)throw Error('Invalid owner reply test window');
  return this.runBoundedTest({maxReplies:1,outsideSchedule,resumeBaseline,timeoutSeconds,onReady,signal,single:true});
 }
 async testRun(confirm,{maxReplies=2,outsideSchedule=false,resumeBaseline=false,timeoutSeconds=300,onReady=async()=>{},signal}={}){
  if(confirm!=='test_bounded_verified_owner_replies')return {allowed:false,reason:'explicit_bounded_owner_reply_test_required'};
  if(!Number.isSafeInteger(maxReplies)||maxReplies<2||maxReplies>3||typeof outsideSchedule!=='boolean'||typeof resumeBaseline!=='boolean'||!Number.isSafeInteger(timeoutSeconds)||timeoutSeconds<30||timeoutSeconds>600)throw Error('Invalid bounded owner reply test');
  return this.runBoundedTest({maxReplies,outsideSchedule,resumeBaseline,timeoutSeconds,onReady,signal,single:false});
 }
 async runBoundedTest({maxReplies,outsideSchedule,resumeBaseline,timeoutSeconds,onReady,signal,single}){
  if(this.live||this.active||this.testRunning||this.#startup)return {allowed:false,reason:'existing_owner_reply_runtime_active'};
  if(signal?.aborted)return {allowed:false,reason:'owner_reply_test_cancelled'};
  // Only the in-memory test instance bypasses the schedule. No saved policy is
  // changed; a restart cannot inherit this exception. Never retry unknown sends.
  let timeout,timedOut=false,cancelled=false;this.testOutcome=null;this.testFailure=null;this.testRunning=true;this.testMaxReplies=maxReplies;this.testReplies=[];
  const bounded=()=>({maxReplies,replyCount:this.testReplies.length,replies:[...this.testReplies],scope:'at_most_'+maxReplies+'_replies',recipientReadVerified:false});
  const cancel=()=>{cancelled=true;void this.stop().catch(()=>{});};
  try{
   const started=await this.#starting(token=>this.#start('start_verified_owner_replies',15,{singleReplyTest:true,ignoreSchedule:outsideSchedule,resumeBaseline,startImmediately:false},token));
   if(!started.allowed)return single?started:{...started,testCompleted:false,...bounded()};
   timeout=setTimeout(()=>{timedOut=true;void this.stop().catch(()=>{});},timeoutSeconds*1000);
   signal?.addEventListener('abort',cancel,{once:true});
   if(signal?.aborted){cancel();return {allowed:false,testCompleted:false,reason:'owner_reply_test_cancelled',...(single?{}:bounded())};}
   const first=await this.tick();
   if(!first.allowed&&!this.testOutcome)return {...first,testCompleted:false,...(timedOut?{reason:'owner_reply_test_timeout'}:cancelled?{reason:'owner_reply_test_cancelled'}:{}),...(single?{}:bounded())};
   if(this.live){
    const state=await this.store.snapshot();
    if(!state.resources.ownerReplies.baselineReady)return {...first,allowed:false,reason:first.reason??'owner_reply_baseline_not_ready',testCompleted:false,...(single?{}:bounded())};
    await onReady({baselineReady:true,resumedBaseline:resumeBaseline,timeoutSeconds,scope:single?'one_new_verified_owner_message':'bounded_new_verified_owner_messages',...(single?{}:{maxReplies,replyCount:this.testReplies.length})});
   }
   while(this.live){
    await new Promise(resolve=>setTimeout(resolve,250));
   }
   if(this.active)await this.active;
   const state=await this.store.snapshot();
   const lastOutcome=state.resources.ownerReplies.lastOutcome;
   const completed=!this.testFailure&&this.testReplies.length===maxReplies;
   const failureReason=this.testFailure?.reason??(timedOut?'owner_reply_test_timeout':cancelled?'owner_reply_test_cancelled':lastOutcome?.allowed===false?lastOutcome.reason:single?'owner_reply_test_ended_without_reply':'owner_reply_test_ended_before_limit');
   const result=single?
    {allowed:this.testOutcome?.allowed===true,testCompleted:!!this.testOutcome,reason:this.testOutcome?.reason??failureReason,result:this.testOutcome,lastOutcome,scope:'at_most_one_reply',recipientReadVerified:false}:
    {allowed:completed,testCompleted:completed,reason:completed?'owner_reply_test_limit_reached':failureReason,lastOutcome,lastReplyOutcome:this.testOutcome,...bounded(),...(this.testFailure?{failure:this.testFailure}:{})};
   return {...result,...(!result.allowed?{automaticRetryAllowed:false,...(lastOutcome?.diagnostic?{diagnostic:lastOutcome.diagnostic}:{}),instruction:'The bounded test has stopped. Do not restart it automatically or infer login/captcha failure from document visibility or iframe presence.'}:{})};
  }finally{
   clearTimeout(timeout);
   signal?.removeEventListener('abort',cancel);
   try{if(this.testMode)await this.stop();}
   finally{this.testMode=false;this.ignoreSchedule=false;this.testRunning=false;this.testMaxReplies=1;}
  }
 }
 // Host restart recovery: only a lease with no heartbeat for the same bounded
 // age as browsing is cleared, and only with an explicit owner confirmation.
 // A fresh lease is still refused, and no half-finished reply is resent.
 async resume(confirm){
  if(this.testRunning||this.#startup)return {allowed:false,reason:'existing_owner_reply_runtime_active'};
  return this.#starting(token=>this.#resume(confirm,token));
 }
 async #resume(confirm,token){
  if(confirm!=='recover_owner_replies_after_host_restart')return {allowed:false,reason:'explicit_owner_replies_recover_required'};
  if(this.live)return {allowed:true,alreadyRunning:true};
  if(typeof this.generate!=='function')return {allowed:false,reason:'DSH_agent_runtime_unavailable'};
  const base=await this.loadBase();
  if(token.cancelled)return {allowed:false,reason:'owner_reply_start_cancelled'};
  let cleared;
  const result=await this.store.transact(s=>{
   if(token.cancelled)return {state:s,value:{allowed:false,reason:'owner_reply_start_cancelled'}};
   const r=s.resources.ownerReplies??freshOwnerReplies();
   if(r.inFlightId){
    const at=r.inFlightAt??r.lastOutcome?.at??null,age=at===null?Number.POSITIVE_INFINITY:this.now()-at;
    if(age<=MAX_LEASE_AGE_MS)return {state:s,value:{allowed:false,reason:'owner_replies_busy_or_stale_lease',leaseAgeMs:age}};
    cleared={id:r.inFlightId,ageMs:age};r.inFlightId=null;r.inFlightAt=null;
    // A reserved event can only belong to the lease that just died, so every
    // leftover reservation is closed instead of blocking the recovered worker.
    for(const e of r.events)if(e.status==='reserved'){e.status='failed';e.reason='lease_cleared_after_host_restart';}
    r.lastOutcome={at:this.now(),allowed:false,reason:'stale_lease_cleared_after_host_restart'};
   }
   if(!r.enabled)return {state:s,value:{allowed:false,reason:'owner_replies_not_enabled',leaseCleared:!!cleared}};
   const probe=structuredClone(s);probe.paused=false;
   const decision=ownerReplyDecision(base,probe,this.now());
   if(!decision.allowed)return {state:s,value:{...decision,leaseCleared:!!cleared}};
   s.paused=false;
   return {state:s,value:{allowed:true,scope:'verified_owner_only',baselineWillSkipExistingMessages:r.baselineReady===false,pollSeconds:r.pollSeconds,leaseCleared:!!cleared}};
  });
  if(!result.allowed)return result;
  if(token.cancelled){await this.stop();return {allowed:false,reason:'owner_reply_start_cancelled'};}
  const pollSeconds=result.pollSeconds??60;
  this.live=true;this.timer=this.setTimer(()=>{void this.tick().catch(()=>{});},pollSeconds*1000);this.timer?.unref?.();
  void this.tick().catch(()=>{});
  return {...result,lease:cleared??null};
 }
 async status(){
  const s=await this.store.snapshot(),r=s.resources.ownerReplies??freshOwnerReplies();
  const base=await this.loadBase();
  return {pluginVersion:'0.8.0-dev.17',runtimeActive:this.live,agentRuntimeAvailable:typeof this.generate==='function',resumeRequired:r.enabled&&!this.live,policy:{enabled:r.enabled,pollSeconds:r.pollSeconds,baselineReady:r.baselineReady,seenCount:r.seen.length,eventCount:r.events.length,deferredCount:r.events.filter(e=>e.status==='deferred').length,inFlightId:r.inFlightId,inFlightAt:r.inFlightAt,lastOutcome:r.lastOutcome},lease:{id:r.inFlightId,at:r.inFlightAt,ageMs:r.inFlightAt?this.now()-r.inFlightAt:null,staleAfterMs:MAX_LEASE_AGE_MS},nextPacing:ownerReplyPacing(base,s,this.now()),nextCheck:ownerReplyDecision(base,structuredClone(s),this.now()),scope:'verified_owner_text_only',strangerRepliesSupported:false,ownerStopPhrasesUnderstood:true,deferredRepliesRetriedFromSavedDraft:true};
 }
}

import {createHash,randomUUID} from 'node:crypto';
import {videoIdFromPage,validateReplyTarget} from './comment-policy.js';
import {ownerLimitDefaults} from './owner-limits.js';
import {validOwnerVideoLink} from './share-policy.js';
import {isBlockingAttempt} from './attempt-review.js';
import {selectedConversation} from './conversation-state.js';
import {selectedVideoSharing} from './video-preferences.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),DAY=86400000;
export const interactionDefaults={dailyLimit:8,intervalSeconds:600,commentDailyLimit:5,replyDailyLimit:5,likeDailyLimit:10,dmDailyLimit:10};
export const interactionProperties=Object.fromEntries(Object.keys(interactionDefaults).map(key=>[key,{type:'integer',minimum:0,maximum:key==='intervalSeconds'?86400:100}]));
export function interactionLimits(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(interactionDefaults,k)))throw Error('Invalid interaction limits');
 const out={...interactionDefaults,...value};
 for(const [k,v]of Object.entries(out))if(!Number.isSafeInteger(v)||v<0||v>interactionProperties[k].maximum)throw Error('Invalid interaction limit: '+k);
 return out;
}
export function validateInteractionAttempts(list){
 if(!Array.isArray(list)||list.length>700)throw Error('Invalid interaction ledger');
 const ids=new Set();
 for(const q of list){if(!q||typeof q.id!=='string'||ids.has(q.id)||!/^[a-f0-9-]{36}$/.test(q.id)||!['comment','reply','like','dm'].includes(q.kind)||!Number.isSafeInteger(q.at)||q.at<0||!/^[a-f0-9]{64}$/.test(q.key)||!['reserved','confirmed','uncertain','not_applied'].includes(q.status)||!(q.receiptId===null||typeof q.receiptId==='string'&&q.receiptId.length>0&&q.receiptId.length<=200))throw Error('Invalid interaction attempt');
  for(const k of ['ownerReportedNotReceived','ownerConfirmedCurrentlyNotLiked','ownerConfirmedReceived','ownerAcknowledgedUncertain'])if(q[k]!==undefined&&typeof q[k]!=='boolean')throw Error('Invalid owner review');
  if(q.ownerAcknowledgedUncertain===true&&(!['uncertain','confirmed'].includes(q.status)||!Number.isSafeInteger(q.ownerAcknowledgedAt)||q.ownerAcknowledgedAt<q.at))throw Error('Invalid archived attempt');
  if(q.ownerReportAt!==undefined&&(!Number.isSafeInteger(q.ownerReportAt)||q.ownerReportAt<q.at))throw Error('Invalid owner review time');
  if(q.nativeMentionOwnerId!==undefined&&(q.kind!=='comment'||!/^[A-Za-z0-9_-]{5,200}$/.test(q.nativeMentionOwnerId)))throw Error('Invalid native mention record');
  ids.add(q.id);}
}
function reviewedManualTest(q,target,ownerRequested){
 if(!ownerRequested||q.ownerReportedNotReceived!==true)return false;
 // A human absence report never authorizes automation. Comments/DMs use a
 // different body; one new like test also requires the human's current-state
 // review and the adapter independently proving unliked immediately pre-click.
 return target.kind==='like'?q.kind==='like'&&q.ownerConfirmedCurrentlyNotLiked===true:q.kind===target.kind&&q.key!==hash(target);
}
export function validateIntent(intent){
 if(!intent||!['comment','reply','like','dm'].includes(intent.kind))throw Error('Invalid interaction kind');
 if(intent.kind==='dm'){
  if(intent.identityKind==='selected_douyin_conversation'){
   if(!/^[a-f0-9]{64}$/.test(intent.recipientId)||intent.sourceRef!=='douyin-conversation:'+intent.recipientId||typeof intent.text!=='string'||!intent.text.trim()||[...intent.text].length>100||/[@＠]|https?:\/\//iu.test(intent.text)||intent.sharedVideoId!==undefined||intent.nativeCardVideoId!==undefined&&(!/^\d{10,25}$/.test(intent.nativeCardVideoId)||intent.text!=='native_video_card'))throw Error('Invalid selected conversation intent');
   if(intent.inReplyTo!==undefined&&!/^[a-f0-9]{64}$/.test(intent.inReplyTo))throw Error('Invalid conversation reply binding');
   return {kind:'dm',identityKind:intent.identityKind,recipientId:intent.recipientId,sourceRef:intent.sourceRef,text:intent.text,...(intent.inReplyTo?{inReplyTo:intent.inReplyTo}:{}),...(intent.nativeCardVideoId?{nativeCardVideoId:intent.nativeCardVideoId}:{})};
  }
  if(intent.identityKind!=='verified_owner_profile_navigation'||typeof intent.recipientId!=='string'||!/^[A-Za-z0-9_-]{5,200}$/.test(intent.recipientId)||intent.sourceRef!=='https://www.douyin.com/user/'+intent.recipientId)throw Error('Real inbox identity adapter is not connected');
  if(typeof intent.text!=='string'||!intent.text.trim()||[...intent.text].length>300||(intent.sharedVideoId!==undefined?!validOwnerVideoLink(intent.text,intent.sharedVideoId):/[@＠]|https?:\/\//iu.test(intent.text)))throw Error('Invalid interaction text');
  if(intent.nativeCardVideoId!==undefined&&(!/^\d{10,25}$/.test(intent.nativeCardVideoId)||intent.text!=='native_video_card'||intent.sharedVideoId!==undefined))throw Error('Invalid native card intent');
  return {kind:'dm',identityKind:intent.identityKind,recipientId:intent.recipientId,sourceRef:intent.sourceRef,text:intent.text,...(intent.sharedVideoId?{sharedVideoId:intent.sharedVideoId}:{}),...(intent.nativeCardVideoId?{nativeCardVideoId:intent.nativeCardVideoId}:{})};
 }
 if(!videoIdFromPage(intent.sourceRef)||videoIdFromPage(intent.sourceRef)!==intent.videoId)throw Error('Exact video binding required');
 const replyTarget=intent.kind==='reply'?validateReplyTarget(intent):null;
 if(intent.kind!=='like'&&(typeof intent.text!=='string'||!intent.text.trim()||[...intent.text].length>300||/[@＠]|https?:\/\//iu.test(intent.text)))throw Error('Invalid interaction text');
 if(intent.nativeMentionOwnerId!==undefined&&(intent.kind!=='comment'||!/^[A-Za-z0-9_-]{5,200}$/.test(intent.nativeMentionOwnerId)))throw Error('Invalid native owner mention');
 return {kind:intent.kind,...replyTarget,sourceRef:'https://www.douyin.com/video/'+intent.videoId,videoId:intent.videoId,...(intent.kind==='like'?{}:{text:intent.text}),...(intent.nativeMentionOwnerId?{nativeMentionOwnerId:intent.nativeMentionOwnerId}:{})};
}
// Read-only preflight also runs before launching a browser. Reservation repeats
// it inside the transaction, so configuration changes cannot race the check.
export function interactionDecision(s,intent,{limits,time=Date.now(),ownerRequested=false,signal}={}){
  const target=validateIntent(intent),at=time,deny=reason=>({allowed:false,reason});
  if(!Number.isSafeInteger(at)||at<s.lastTime)return deny('clock_rollback');
  if(s.paused&&!ownerRequested)return deny('interaction_paused');
  if(signal?.aborted)return deny('cancelled');
  const policy=interactionLimits({...interactionLimits(limits),...s.resources.persona?.interactionLimits});
  if(!ownerRequested&&target.videoId&&s.resources.interactionQuarantine?.includes(target.videoId))return deny('video_quarantined_by_owner');
  if(target.nativeMentionOwnerId){const owner=s.resources.ownerIdentity;if(owner?.verified!==true||owner.platformId!==target.nativeMentionOwnerId||s.resources.persona?.ownerId!==owner.platformId)return deny('verified_owner_mention_required');}
  if(target.kind==='dm'){
   if(target.identityKind==='selected_douyin_conversation'){
    const permitted=target.nativeCardVideoId?selectedVideoSharing(s,target.recipientId):selectedConversation(s,target.recipientId)&&s.resources.conversationReplies?.enabled&&s.resources.conversationReplies.lease;
    if(!permitted||s.resources.conversations?.ownerId===target.recipientId)return deny('conversation_not_authorized');
   }else{
    const owner=s.resources.ownerIdentity;
    if(owner?.verified!==true||owner.platformId!==target.recipientId||s.resources.persona?.ownerId!==target.recipientId)return deny('verified_owner_recipient_required');
    if(s.resources.persona?.limits?.allowOwnerDm===false)return deny('owner_dm_disabled_by_policy');
   }
  }
  const a=(s.resources.interactionAttempts??[]).filter(q=>q.status!=='confirmed'||at-q.at<7*DAY),recent=a.filter(q=>at-q.at<DAY),key=hash(target);
  // A running dispatch always blocks concurrency. An uncertain result blocks
  // automation and the same action kind. Explicit owner tests of a different
  // kind do not retry the uncertain action and may proceed independently.
  const sameAction=q=>q.kind===target.kind&&(!target.nativeMentionOwnerId||Boolean(q.nativeMentionOwnerId));
  // A native owner mention is a separately authorized UI action, not a retry
  // of an ordinary comment. An unresolved mention still blocks another mention.
  if(a.some(q=>q.status==='reserved'||q.status==='uncertain'&&q.ownerAcknowledgedUncertain!==true&&(!ownerRequested||sameAction(q)&&!reviewedManualTest(q,target,ownerRequested))))return deny('interaction_result_unresolved');
  if(a.some(q=>q.key===key&&q.status!=='not_applied'&&!(q.status==='uncertain'&&reviewedManualTest(q,target,ownerRequested))))return deny('interaction_duplicate');
  if(!s.resources.development?.enabled){
    if(recent.length>=policy.dailyLimit||recent.filter(q=>q.kind===target.kind).length>=policy[target.kind+'DailyLimit'])return deny('interaction_daily_limit');
    if(recent.some(q=>at-q.at<policy.intervalSeconds*1000))return deny('interaction_cooldown');
    if(target.kind==='dm'){
      const p={...ownerLimitDefaults,...s.resources.persona?.limits},recipientHash=hash(target.recipientId),contactRecent=recent.filter(q=>q.kind==='dm'&&(!q.recipientHash||q.recipientHash===recipientHash));
      if(contactRecent.length>=p.dmDailyLimitPerContact)return deny('dm_contact_daily_limit');
      if(contactRecent.some(q=>at-q.at<p.dmIntervalSeconds*1000))return deny('dm_contact_cooldown');
    }
  }
  if(a.length>=700)return deny('interaction_ledger_full');
  return {allowed:true};
}
// Browser adapters must supply a target proof and a persisted receipt.
export async function dispatchInteraction({store,adapter,intent,limits,signal,now=Date.now,ownerRequested=false}){
 if(!adapter||typeof adapter.inspectTarget!=='function'||typeof adapter.sendOnce!=='function')return {allowed:false,reason:'interaction_adapter_unavailable',sendingSupported:false};
 const target=validateIntent(intent);
 const preflight=interactionDecision(await store.snapshot(),target,{limits,time:now(),ownerRequested,signal});
 if(!preflight.allowed)return preflight;
 const proof=await adapter.inspectTarget(target,{signal});
 if(!proof||proof.targetHash!==hash(target)||proof.ready!==true)return {allowed:false,reason:'interaction_target_changed'};
 const reserved=await store.transact(s=>{
  const at=now(),decision=interactionDecision(s,target,{limits,time:at,ownerRequested,signal});
  if(!decision.allowed)return {state:s,value:decision};
  const a=(s.resources.interactionAttempts??[]).filter(q=>q.status!=='confirmed'||at-q.at<7*DAY),key=hash(target);
  const attempt={id:randomUUID(),key,kind:target.kind,at,status:'reserved',receiptId:null,...(target.nativeMentionOwnerId?{nativeMentionOwnerId:target.nativeMentionOwnerId}:{}),...(target.kind==='dm'?{recipientHash:hash(target.recipientId)}:{})};a.push(attempt);
  s.resources.interactionAttempts=a;s.lastTime=at;
  return {state:s,value:{allowed:true,id:attempt.id}};
 });
 if(!reserved.allowed)return reserved;
 // Reservation is durable BEFORE attempting a side effect. No automatic resend.
 let result;
 try{
  if(signal?.aborted)throw Error('cancelled_after_reservation');
  const receipt=await adapter.sendOnce(target,{signal,attemptId:reserved.id});
  result=receipt?.verified===true&&receipt.targetHash===hash(target)&&typeof receipt.receiptId==='string'&&receipt.receiptId.length>0&&receipt.receiptId.length<=200?
   {status:'confirmed',receiptId:receipt.receiptId}:{status:'uncertain',receiptId:null};
 }catch(error){result={status:error?.actionNotApplied===true?'not_applied':'uncertain',receiptId:null,error:String(error?.message||'interaction_failed').slice(0,200)};}
 await store.transact(s=>{const q=s.resources.interactionAttempts.find(q=>q.id===reserved.id);if(!q||q.status!=='reserved')throw Error('Interaction receipt state changed');Object.assign(q,result);return {state:s,value:null};});
 return {allowed:result.status==='confirmed',attemptId:reserved.id,status:result.status,...(result.receiptId?{receiptId:result.receiptId}:{}),...(result.error?{error:result.error}:{}),retryAllowed:false};
}
export const interactionTargetHash=hash;

import {validateIntent,interactionTargetHash} from './interaction-gate.js';
import {videoIdFromPage} from './comment-policy.js';import {liveVerificationView} from './live-verification.js';
export function confirmOwnerReceipt(state,args,time=Date.now()){
 const mention=args.kind==='native_mention',card=args.kind==='native_card',dm=args.kind==='owner_dm';
 if(!mention&&!card&&!dm||args.confirm!==(mention?'owner_saw_exact_mention_and_notification':dm?'owner_received_exact_dm':'owner_opened_exact_native_card'))return {state,value:{allowed:false,reason:'explicit_owner_receipt_confirmation_required'}};
 if(!state.paused)return {state,value:{allowed:false,reason:'pause_before_owner_confirmation'}};
 const owner=state.resources.ownerIdentity,videoId=videoIdFromPage(args.sourceRef);
 if(owner?.verified!==true||state.resources.persona?.ownerId!==owner.platformId||(dm?args.sourceRef!=='https://www.douyin.com/user/'+owner.platformId:!videoId))return {state,value:{allowed:false,reason:'exact_verified_owner_and_source_required'}};
 if(!Number.isSafeInteger(time)||time<state.lastTime)throw Error('Invalid owner receipt time');
 const target=validateIntent(mention?{kind:'comment',videoId,sourceRef:args.sourceRef,text:args.text,nativeMentionOwnerId:owner.platformId}:{kind:'dm',identityKind:'verified_owner_profile_navigation',recipientId:owner.platformId,sourceRef:'https://www.douyin.com/user/'+owner.platformId,...(dm?{text:args.text}:{text:'native_video_card',nativeCardVideoId:videoId})});
 const q=state.resources.interactionAttempts?.find(q=>q.id===args.attemptId&&q.key===interactionTargetHash(target));
 if(!q||!['uncertain','confirmed'].includes(q.status))return {state,value:{allowed:false,reason:'exact_submitted_attempt_required'}};
 q.status='confirmed';q.ownerConfirmedReceived=true;q.ownerReportAt=time;q.receiptId??='owner-confirmed-'+args.kind+':'+q.id;
 if(dm){
  const event=state.resources.ownerReplies?.ownerId===owner.platformId?state.resources.ownerReplies.events.find(e=>e.attemptId===q.id):null;
  if(event){event.status='confirmed';event.ownerConfirmedReceived=true;event.ownerReportAt=time;}
 }else{
  state.resources.liveVerification??={};state.resources.liveVerification[mention?'nativeMention':'nativeCard']={attemptId:q.id,ownerId:owner.platformId,videoId,at:time,source:'owner_confirmation',notificationVerified:mention,publicVisibilityVerified:mention};
 }
 state.lastTime=time;
 return {state,value:{allowed:true,attemptId:q.id,status:'confirmed',source:'owner_confirmation',sendingPerformed:false,...liveVerificationView(state)}};
}

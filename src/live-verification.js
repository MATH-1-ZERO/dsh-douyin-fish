export function validateLiveVerification(resources){
 if(resources===undefined)return;
 const v=resources.liveVerification;if(v===undefined)return;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['nativeMention','nativeCard'].includes(k)))throw Error('Invalid live verification');
 for(const [kind,p]of Object.entries(v)){
  if(!p||Object.keys(p).some(k=>!['attemptId','ownerId','videoId','at','source','notificationVerified','publicVisibilityVerified'].includes(k))||!/^[-A-Za-z0-9_]{5,200}$/.test(p.ownerId)||!/^\d{10,25}$/.test(p.videoId)||!Number.isSafeInteger(p.at)||p.at<0||p.source!=='owner_confirmation'||typeof p.notificationVerified!=='boolean'||typeof p.publicVisibilityVerified!=='boolean')throw Error('Invalid live verification proof');
  const q=resources.interactionAttempts?.find(q=>q.id===p.attemptId);
  if(!q||q.status!=='confirmed'||q.ownerConfirmedReceived!==true||q.kind!==(kind==='nativeMention'?'comment':'dm')||kind==='nativeMention'&&q.nativeMentionOwnerId!==p.ownerId)throw Error('Live verification requires an exact confirmed attempt');
 }
}
export function liveVerificationView(s){validateLiveVerification(s.resources);const owner=s.resources.ownerIdentity,p=s.resources.liveVerification;
 const valid=q=>owner?.verified===true&&s.resources.persona?.ownerId===owner.platformId&&q?.ownerId===owner.platformId;
 const replies=s.resources.ownerReplies;
 const replyProof=valid(replies)?replies.events.find(e=>e.status==='confirmed'&&e.ownerConfirmedReceived===true&&s.resources.interactionAttempts?.some(q=>q.id===e.attemptId&&q.kind==='dm'&&q.status==='confirmed'&&q.ownerConfirmedReceived===true)):null;
 return {ownerReplyLiveVerified:!!replyProof,...(replyProof?{ownerReplyProof:{attemptId:replyProof.attemptId,at:replyProof.ownerReportAt,source:'owner_confirmation'}}:{}),nativeMentionLiveVerified:valid(p?.nativeMention),nativeCardLiveVerified:valid(p?.nativeCard),scope:'exact_owner_confirmed_attempt_only_not_every_video_or_future_platform_version',...(valid(p?.nativeMention)?{mentionProof:p.nativeMention}:{}),...(valid(p?.nativeCard)?{cardProof:p.nativeCard}:{})};
}

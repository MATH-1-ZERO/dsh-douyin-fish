import {videoPreferences} from './video-preferences.js';
import {setTimeout as delay} from 'node:timers/promises';
import {videoIdFromPage} from './comment-policy.js';
import {readOwnerPublicProof} from './owner-public-proof.js';
import {reserveBrowserWorkflow} from './browser-workflow.js';
import {readOneVideo} from './manual-browser.js';
import {runPublicVideoSession as runSmoke} from './retained-browser.js';
import {visitOwnerConversation} from './owner-dm.js';
import {ownerDmSendExpression} from './browser/owner-dm-send-expression.mjs';
import {dispatchInteraction,interactionDecision,interactionTargetHash} from './interaction-gate.js';
import {waitForStableReceipt} from './interaction-settle.js';
import {liveVerificationView} from './live-verification.js';
export async function sendOwnerNativeCard(settings,args,deps){
 if(args.confirm!=='share_one_native_video_card_to_boss')return {allowed:false,reason:'explicit_native_share_required'};
 if(settings.inboundPolicy?.allowOwner===false)return {allowed:false,reason:'owner_dm_disabled_by_policy'};
 const videoId=videoIdFromPage(args.sourceRef),s=await deps.store.snapshot(),owner=s.resources.ownerIdentity;
 if(!videoId)throw Error('Exact public video required');
 if(owner?.verified!==true||s.resources.persona?.ownerId!==owner.platformId)return {allowed:false,reason:'verified_owner_required'};
 // Automatic native delivery remains unavailable until a persistent real card
 // receipt has been independently validated. No fallback to a text URL.
 if(deps.autonomous&&!liveVerificationView(s).nativeCardLiveVerified)return {allowed:false,reason:'native_share_live_verification_required'};
 const ownerRequested=deps.autonomous!==true,authorized=state=>!state.paused&&state.resources.autonomy?.enabled&&state.resources.autonomy.inFlightId===deps.autonomyLeaseId&&(['share_card','comment_or_share_card'].includes(state.resources.autonomy.deliveryMode)||state.resources.autonomy.deliveryMode==='console_preferences'&&videoPreferences(state).shareEnabled&&videoPreferences(state).shareRecipient==='owner')&&deps.expectedOwnerId===owner.platformId;
 if(!ownerRequested&&!authorized(s))return {allowed:false,reason:'autonomous_card_sharing_not_enabled'};
 const intent={kind:'dm',identityKind:'verified_owner_profile_navigation',recipientId:owner.platformId,sourceRef:'https://www.douyin.com/user/'+owner.platformId,text:'native_video_card',nativeCardVideoId:videoId};
 const preflight=interactionDecision(s,intent,{limits:settings.interactionLimits,ownerRequested});if(!preflight.allowed)return preflight;
 const workflow=deps.browserWorkflow?{allowed:true,ticket:deps.browserWorkflow}:await reserveBrowserWorkflow(settings,deps.store);if(!workflow.allowed)return workflow;
 const shared={...deps,browserWorkflow:workflow.ticket};
 const verified=await (deps.publicProof??readOwnerPublicProof)(settings,shared);if(!verified.allowed)return verified;
 const proof=verified.proof,scope={videoId,ownerPlatformId:owner.platformId,ownerHandle:owner.ownerHandle,ownerName:proof.ownerName,ownerAvatarResource:proof.avatarResource};
 let interaction,sendClicked=false,raw;
 const read=await readOneVideo(settings,{confirm:'read_one_public_video',sourceRef:args.sourceRef},{...shared,run:async options=>{
  raw=await (deps.run??runSmoke)({...options,afterReady:async({settings:browserSettings,read,signal})=>{
   const operation=async phase=>{const r=await read(browserSettings,{signal,operation:{...scope,phase}});if(!r.allowed||!r.operationResult?.ready){const e=Error(r.operationResult?.reason||r.reason||'Native share guard refused');e.actionNotApplied=!sendClicked;throw e;}return r.operationResult;};
   await operation('hover_share_open');await (deps.delay??delay)(1000,undefined,{signal});
   const adapter={inspectTarget:async target=>{await operation('point_native_share_send');return {ready:true,targetHash:interactionTargetHash(target)};},sendOnce:async()=>{
    const latest=await deps.store.snapshot();
    if(latest.resources.ownerIdentity?.platformId!==owner.platformId||latest.resources.ownerIdentity?.verified!==true||latest.resources.persona?.ownerId!==owner.platformId||Date.now()-proof.verifiedAt>120000||!ownerRequested&&!authorized(latest)){const e=Error('Native owner binding changed or expired');e.actionNotApplied=true;throw e;}
    await operation('click_native_share_send');sendClicked=true;
    await (deps.delay??delay)(10000,undefined,{signal});return {verified:false};
   }};
   interaction=await dispatchInteraction({store:deps.store,adapter,intent,limits:settings.interactionLimits,ownerRequested,signal});return interaction;
  }});return raw;
 }});
 let receipt;
 if(sendClicked&&(read.checks?.ownBrowserStopped&&read.checks?.portReleased||read.checks?.browserReused&&read.checks?.browserRetained&&read.checks?.sessionReleased)){
  receipt=await (deps.visitOwner??visitOwnerConversation)(settings,{confirm:'visit_verified_owner_conversation'},shared,async({scope,evaluate,reopen,signal})=>{
   const operation=()=>evaluate(ownerDmSendExpression({...scope,phase:'card_receipt',nativeCardVideoId:videoId})),accept=r=>r?.ready&&r.editorEmpty&&r.matches?.length===1&&r.matches[0].outgoing&&r.matches[0].nativeVideoCard;
   const options={signal,pause:deps.delay??delay,now:deps.monotonicNow,minimumMs:1000};
   const initial=await waitForStableReceipt(operation,accept,options);if(!initial)return {persistenceVerified:false,diagnostic:await evaluate(ownerDmSendExpression({...scope,phase:'card_inspect',nativeCardVideoId:videoId}))};
   await reopen('native_video_card');const persisted=await waitForStableReceipt(operation,accept,options);return {persistenceVerified:!!persisted,videoId};
  });
 }
 const persisted=receipt?.allowed===true&&receipt.report?.result?.persistenceVerified===true;
 if(persisted&&interaction?.attemptId)await deps.store.transact(s=>{const q=s.resources.interactionAttempts.find(q=>q.id===interaction.attemptId);if(q?.status==='uncertain'&&q.key===interactionTargetHash(intent)&&!q.ownerReportedNotReceived){q.status='confirmed';q.receiptId='ui-native-card:'+q.key;interaction={...interaction,allowed:true,status:'confirmed',receiptId:q.receiptId};}return {state:s,value:null};});
 const confirmed=interaction?.status==='confirmed';
 return {allowed:confirmed,shareKind:'native_video_card',nativeShareCardRequested:true,nativeShareCardVerified:confirmed,videoId,interaction,sendAttempted:sendClicked,sent:confirmed?true:sendClicked?null:false,persistenceVerified:confirmed,recipientReadVerified:false,
  reason:confirmed?undefined:receipt?.report?.error??(sendClicked?'native_card_receipt_unverified':read.reason),receipt:receipt?.report?.result,
  checks:{sendBrowser:read.checks,receiptBrowser:receipt?{bindingVerified:receipt.report?.bindingVerified,ownBrowserStopped:receipt.report?.ownBrowserStopped,portReleased:receipt.report?.portReleased,browserRetained:receipt.report?.browserRetained,sessionReleased:receipt.report?.sessionReleased}:undefined}};
}

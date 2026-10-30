import {setTimeout as delay} from 'node:timers/promises';
import {videoIdFromPage} from './comment-policy.js';
import {videoRecipient,selectedVideoSharing} from './video-preferences.js';
import {verifyConversationCard} from './conversation-browser.js';
import {avatarResource} from './live-browser/owner-public-proof.mjs';
import {readOneVideo} from './manual-browser.js';
import {runPublicVideoSession} from './retained-browser.js';
import {dispatchInteraction,interactionDecision,interactionTargetHash} from './interaction-gate.js';

export async function sendSelectedNativeCard(settings,args,deps){
 const state=await deps.store.snapshot(),contact=videoRecipient(state),videoId=videoIdFromPage(args.sourceRef);
 const authorized=s=>!s.paused&&selectedVideoSharing(s,contact?.id)&&s.resources.autonomy.inFlightId===deps.autonomyLeaseId;
 if(!videoId||!contact||contact.kind!=='contact'||!authorized(state))return {allowed:false,reason:'selected_native_share_not_authorized'};
 const intent={kind:'dm',identityKind:'selected_douyin_conversation',recipientId:contact.id,sourceRef:'douyin-conversation:'+contact.id,text:'native_video_card',nativeCardVideoId:videoId};
 const gate=interactionDecision(state,intent,{limits:settings.interactionLimits,signal:deps.signal});if(!gate.allowed)return gate;
 const verify=deps.verifyConversation??verifyConversationCard;
 const proof=await verify(contact,videoId,{...deps,settings});if(!proof.allowed)return proof;
 const scope={videoId,recipientKind:'selected_conversation',recipientKey:contact.id,account:contact.account,ownerName:contact.name,ownerAvatarResource:avatarResource(contact.avatar)};
 let interaction,sendClicked=false;
 const read=await (deps.read??readOneVideo)(settings,{confirm:'read_one_public_video',sourceRef:args.sourceRef},{...deps,run:options=>(deps.run??runPublicVideoSession)({...options,afterReady:async({settings:browserSettings,read,signal})=>{
  const operation=async phase=>{const r=await read(browserSettings,{signal,operation:{...scope,phase}});if(!r.allowed||!r.operationResult?.ready){const e=Error(r.operationResult?.reason||r.reason||'native_share_guard_refused');e.actionNotApplied=!sendClicked;throw e;}return r.operationResult;};
  await operation('hover_share_open');await (deps.delay??delay)(1000,undefined,{signal});
  interaction=await dispatchInteraction({store:deps.store,intent,limits:settings.interactionLimits,signal,adapter:{
   inspectTarget:async target=>{await operation('point_native_share_send');return {ready:true,targetHash:interactionTargetHash(target)};},
   sendOnce:async()=>{if(!authorized(await deps.store.snapshot())||Date.now()-proof.verifiedAt>120000){const e=Error('selected_native_share_scope_changed');e.actionNotApplied=true;throw e;}await operation('click_native_share_send');sendClicked=true;await (deps.delay??delay)(10000,undefined,{signal});return {verified:false};}
  }});return interaction;
 }})});
 if(sendClicked&&(read.checks?.ownBrowserStopped&&read.checks?.portReleased||read.checks?.browserReused&&read.checks?.browserRetained&&read.checks?.sessionReleased)){
  const receipt=await verify(contact,videoId,{...deps,settings},true);
  if(receipt.allowed&&interaction?.attemptId)await deps.store.transact(s=>{const q=s.resources.interactionAttempts.find(x=>x.id===interaction.attemptId);if(q?.status==='uncertain'&&q.key===interactionTargetHash(intent)){q.status='confirmed';q.receiptId='ui-selected-card:'+q.key;interaction={...interaction,allowed:true,status:'confirmed',receiptId:q.receiptId};}return {state:s,value:null};});
 }
 return {allowed:interaction?.status==='confirmed',interaction,sendAttempted:sendClicked,sent:interaction?.status==='confirmed'?true:sendClicked?null:false,shareKind:'native_video_card',recipientReadVerified:false,reason:interaction?.status==='confirmed'?undefined:read.reason??'native_card_receipt_unverified'};
}

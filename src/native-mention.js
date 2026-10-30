import {setTimeout as delay} from 'node:timers/promises';
import {videoIdFromPage,commentFingerprint} from './comment-policy.js';
import {readOwnerPublicProof} from './owner-public-proof.js';
import {reserveBrowserWorkflow} from './browser-workflow.js';
import {readOneVideo} from './manual-browser.js';
import {runPublicVideoSession as runSmoke} from './retained-browser.js';
import {dispatchInteraction,interactionDecision,interactionTargetHash} from './interaction-gate.js';
import {waitForStableReceipt} from './interaction-settle.js';
import {manualSettings} from './manual.js';
import {liveVerificationView} from './live-verification.js';
// Re-check one already recorded native mention. Read-only: it never submits
// anything, never widens the target, and only upgrades our own local receipt.
export async function checkOwnerMention(settings,args,deps){
 if(args.confirm!=='check_one_recorded_native_owner_mention')return {allowed:false,reason:'explicit_native_mention_check_required',sendingPerformed:false};
 const videoId=videoIdFromPage(args.sourceRef),text=args.text,c=manualSettings(settings);
 if(!videoId||typeof text!=='string'||!text.trim()||text.trim()!==text||[...text].length>Math.min(c.maxCharacters,40)||/[@＠]|https?:\/\/|[\r\n]/iu.test(text)||(text.match(/\p{Extended_Pictographic}/gu)||[]).length>c.maxEmoji)throw Error('Exact recorded native mention required');
 const state=await deps.store.snapshot(),owner=state.resources.ownerIdentity;
 if(owner?.verified!==true||state.resources.persona?.ownerId!==owner.platformId)return {allowed:false,reason:'verified_owner_required',sendingPerformed:false};
 const intent={kind:'comment',sourceRef:'https://www.douyin.com/video/'+videoId,videoId,text,nativeMentionOwnerId:owner.platformId};
 const key=interactionTargetHash(intent);
 const q=state.resources.interactionAttempts?.find(q=>q.id===args.attemptId&&q.kind==='comment'&&q.key===key&&q.nativeMentionOwnerId===owner.platformId);
 if(!q)return {allowed:false,reason:'recorded_native_mention_not_found',sendingPerformed:false};
 if(q.status==='confirmed')return {allowed:true,alreadyConfirmed:true,receiptId:q.receiptId,sendingPerformed:false};
 if(q.status!=='uncertain')return {allowed:false,reason:'native_mention_not_pending_confirmation',sendingPerformed:false};
 const reservation=await reserveBrowserWorkflow(settings,deps.store,{stages:2});if(!reservation.allowed)return reservation;
 const shared={...deps,browserWorkflow:reservation.ticket},verified=await (deps.publicProof??readOwnerPublicProof)(settings,shared);if(!verified.allowed)return verified;
 const proof=verified.proof,scope={videoId,ownerPlatformId:owner.platformId,ownerHandle:owner.ownerHandle,ownerName:proof.ownerName,ownerAvatarResource:proof.avatarResource,mentionText:text};
 let found,refusal;
 const result=await (deps.read??readOneVideo)(settings,{confirm:'read_one_public_video',sourceRef:args.sourceRef},{...shared,run:options=>(deps.run??runSmoke)({...options,inspectInteractionUi:true,openCommentPanel:true,afterReady:async({settings:browserSettings,read,signal})=>{
  const operation=async phase=>{const p=await read(browserSettings,{signal,operation:{...scope,phase}});if(!p.allowed||!p.operationResult?.ready)throw Error(p.operationResult?.reason||p.reason||'native_mention_check_refused');return p.operationResult;};
  let stable=0;found=null;
  for(let i=0;i<16;i++){
   if(signal?.aborted)throw Error('Cancelled');
   let r;try{r=await operation('native_mention_receipt');}catch(e){refusal=String(e.message).slice(0,160);break;}
   if(r.matches?.length===1&&r.matches[0].ownerMentionLinked&&r.matches[0].authorId&&r.editorEmpty){found=r.matches[0];if(++stable>=2)break;}
   else{stable=0;found=null;}
   await (deps.delay??delay)(500,undefined,{signal});
  }
  return {found,stable,refusal};
 }})});
 if(!result.allowed)return {...result,sendingPerformed:false};
 const observation=result.report?.result;
 if(!observation?.found)return {allowed:false,reason:observation?.refusal?'native_mention_check_inconclusive':'native_mention_not_found',refusal:observation?.refusal??null,sendingPerformed:false,publicVisibilityVerified:false,ownerNotificationVerified:false};
 return deps.store.transact(s=>{
  const current=s.resources.interactionAttempts?.find(q=>q.id===args.attemptId&&q.kind==='comment'&&q.key===key&&q.nativeMentionOwnerId===owner.platformId);
  if(s.resources.ownerIdentity?.verified!==true||s.resources.ownerIdentity.platformId!==owner.platformId||s.resources.persona?.ownerId!==owner.platformId||!current||current.status!=='uncertain')throw Error('Native mention confirmation state changed');
  current.status='confirmed';current.receiptId='ui-native-mention:'+commentFingerprint(videoId,observation.found.authorId,text);current.reconciledAt=Date.now();current.reconciliationMethod='fresh_public_comment_observation';
  for(const draft of s.resources.manualDrafts)if(draft.deliveryAttemptId===current.id&&draft.status==='send_uncertain')draft.status='confirmed_sent';
  return {state:s,value:{allowed:true,attemptId:current.id,status:'confirmed',receiptId:current.receiptId,sendingPerformed:false,verification:'fresh_visible_comment_with_structured_owner_mention',publicVisibilityVerified:false,ownerNotificationVerified:false}};
 });
}
export async function publishOwnerMention(settings,args,deps){
 if(args.confirm!=='publish_one_native_owner_mention')return {allowed:false,reason:'explicit_native_mention_required'};
 if(deps.autonomous&&!liveVerificationView(await deps.store.snapshot()).nativeMentionLiveVerified)return {allowed:false,reason:'native_mention_live_verification_required'};
 const videoId=videoIdFromPage(args.sourceRef),text=args.text,c=manualSettings(settings);
 if(!videoId||typeof text!=='string'||!text.trim()||text.trim()!==text||[...text].length>Math.min(c.maxCharacters,40)||/[@＠]|https?:\/\/|[\r\n]/iu.test(text)||(text.match(/\p{Extended_Pictographic}/gu)||[]).length>c.maxEmoji)throw Error('Exact video and short native mention body required');
 const s=await deps.store.snapshot(),owner=s.resources.ownerIdentity;
 if(owner?.verified!==true||s.resources.persona?.ownerId!==owner.platformId)return {allowed:false,reason:'verified_owner_required'};
 const ownerRequested=deps.autonomous!==true,authorized=state=>!state.paused&&state.resources.autonomy?.enabled&&state.resources.autonomy.inFlightId===deps.autonomyLeaseId&&state.resources.autonomy.deliveryMode==='mention_owner'&&deps.expectedOwnerId===owner.platformId;
 if(!ownerRequested&&!authorized(s))return {allowed:false,reason:'autonomous_mention_not_enabled'};
 const intent={kind:'comment',sourceRef:args.sourceRef,videoId,text,nativeMentionOwnerId:owner.platformId};
 const gate=interactionDecision(s,intent,{limits:settings.interactionLimits,ownerRequested,signal:deps.signal});if(!gate.allowed)return gate;
 const reservation=deps.browserWorkflow?{allowed:true,ticket:deps.browserWorkflow}:await reserveBrowserWorkflow(settings,deps.store,{stages:2});if(!reservation.allowed)return reservation;
 const shared={...deps,browserWorkflow:reservation.ticket},verified=await (deps.publicProof??readOwnerPublicProof)(settings,shared);if(!verified.allowed)return verified;
 const proof=verified.proof,scope={videoId,ownerPlatformId:owner.platformId,ownerHandle:owner.ownerHandle,ownerName:proof.ownerName,ownerAvatarResource:proof.avatarResource,mentionText:text};
 let interaction,submitted=false,entitySelected=false,cleanupVerified=true;
 const result=await (deps.read??readOneVideo)(settings,{confirm:'read_one_public_video',sourceRef:args.sourceRef},{...shared,run:options=>(deps.run??runSmoke)({...options,inspectInteractionUi:true,openCommentPanel:true,afterReady:async({settings:browserSettings,read,signal})=>{
  const operation=async phase=>{const p=await read(browserSettings,{signal,operation:{...scope,phase}});if(!p.allowed||!p.operationResult?.ready)throw Error(p.operationResult?.reason||p.reason||'native_mention_guard_refused');return p.operationResult;};
  try{
   await operation('click_mention_open');cleanupVerified=false;
   await (deps.delay??delay)(500,undefined,{signal});await operation('append_owner_mention_query');
   await (deps.delay??delay)(2500,undefined,{signal});await operation('click_mention_candidate');
   await (deps.delay??delay)(300,undefined,{signal});entitySelected=(await operation('native_mention_state')).selected===true;
   if(!entitySelected)throw Error('Native mention entity not verified');
   const adapter={inspectTarget:async target=>{const r=await operation('native_mention_receipt');return {ready:r.matches.length===0,targetHash:interactionTargetHash(target)};},sendOnce:async target=>{
    const latest=await deps.store.snapshot();if(latest.resources.ownerIdentity?.platformId!==owner.platformId||latest.resources.ownerIdentity?.verified!==true||latest.resources.persona?.ownerId!==owner.platformId||Date.now()-proof.verifiedAt>120000||!ownerRequested&&!authorized(latest)){const e=Error('Owner binding changed');e.actionNotApplied=true;throw e;}
    let filled;try{filled=await operation('append_native_mention_body');}catch(e){e.actionNotApplied=true;throw e;}
    if(!filled.filled){const e=Error('Native mention input not verified');e.actionNotApplied=true;throw e;}
    await operation('click_native_mention_submit');submitted=true;
    const opts={signal,pause:deps.delay??delay,now:deps.monotonicNow};
    const accept=r=>r.editorEmpty&&r.matches.length===1&&r.matches[0].ownerMentionLinked&&r.matches[0].authorId;
    const initial=await waitForStableReceipt(()=>operation('native_mention_receipt'),accept,opts);if(!initial)return {verified:false};
    try{await operation('refresh');}catch{}
    let panelOpened=false;
    const persisted=await waitForStableReceipt(async()=>{try{const p=await read(browserSettings,{signal,includeComments:true,openCommentPanel:!panelOpened,operation:{...scope,phase:'native_mention_receipt'}});if(p.commentPanelClickPerformed)panelOpened=true;return p.operationResult??{matches:[]};}catch{signal?.throwIfAborted();return {matches:[]};}},r=>accept(r)&&r.matches[0].authorId===initial.matches[0].authorId,{...opts,minimumMs:1000});
    return persisted?{verified:true,targetHash:interactionTargetHash(target),receiptId:'ui-native-mention:'+commentFingerprint(videoId,initial.matches[0].authorId,text)}:{verified:false};
   }};
   interaction=await dispatchInteraction({store:deps.store,adapter,intent,limits:settings.interactionLimits,signal,ownerRequested});return interaction;
  }finally{
   if(!submitted&&!cleanupVerified){try{cleanupVerified=(await operation('clear_native_mention')).cleared===true;}catch{cleanupVerified=false;}}
  }
 }})});
 return {...result,allowed:result.allowed&&interaction?.status==='confirmed',interaction,nativeMention:true,entitySelected,sendAttempted:submitted,cleanupVerified:submitted?null:cleanupVerified,
  persistenceVerified:interaction?.status==='confirmed',publicVisibilityVerified:false,ownerNotificationVerified:false};
}

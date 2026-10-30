import {videoPreferences} from './video-preferences.js';
import {dispatchInteraction,interactionTargetHash,interactionDecision} from './interaction-gate.js';
import {readOneVideo} from './manual-browser.js';
import {runPublicVideoSession as runSmoke} from './retained-browser.js';
import {setTimeout as delay} from 'node:timers/promises';
import {videoIdFromPage,commentFingerprint} from './comment-policy.js';
import {waitForStableReceipt} from './interaction-settle.js';
import {manualSettings} from './manual.js';
function validatePublicText(settings,text){
 const c=manualSettings(settings);
 if(typeof text!=='string'||!text.trim()||text.trim()!==text||[...text].length>c.maxCharacters||text.split(/\r?\n/).length>c.maxLines||(text.match(/\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3/gu)||[]).length>c.maxEmoji||/[@＠]|https?:\/\//iu.test(text))throw Error('Invalid bounded public text');
}
// Development adapters; native public sending stays disabled until live verified.
export async function performLike(settings,args,deps){
 if(args.confirm!=='like_one_exact_video')return {allowed:false,reason:'explicit_like_required'};
 const videoId=videoIdFromPage(args.sourceRef);if(!videoId)throw Error('Exact approved video required');
 const intent={kind:'like',sourceRef:args.sourceRef,videoId};
 const gate=interactionDecision(await deps.store.snapshot(),intent,{limits:settings.interactionLimits,time:(deps.now??Date.now)(),ownerRequested:true,signal:deps.signal});
 if(!gate.allowed)return {...gate,sendingPerformed:false};
 let interaction;
 const result=await (deps.read??readOneVideo)(settings,{confirm:'read_one_public_video',sourceRef:args.sourceRef}, {...deps,run:options=>(deps.run??runSmoke)({...options,afterReady:async({settings:browserSettings,read,signal})=>{
  const operation=async phase=>{
   const p=await read(browserSettings,{signal,operation:{phase,videoId}});
   if(!p.allowed||!p.operationResult?.ready)throw Error(p.operationResult?.reason||p.reason||'bound_operation_refused');return p.operationResult;
  };
  const adapter={inspectTarget:async target=>{
   const p=await operation('inspect');return {ready:p.like?.state==='unliked',targetHash:interactionTargetHash(target)};
  },sendOnce:async target=>{
   await operation('click_like');
   const waitOptions={signal,pause:deps.delay??delay,now:deps.monotonicNow};
   const settled=await waitForStableReceipt(()=>operation('inspect'),p=>p.like?.state==='liked',waitOptions);
   if(!settled)return {verified:false};
   try{await operation('refresh');}catch{/* reload can destroy the old world */}
   const persisted=await waitForStableReceipt(async()=>{
    try{return await operation('inspect');}catch{signal?.throwIfAborted();return null;}
   },p=>p?.like?.state==='liked',{...waitOptions,minimumMs:1000});
   return persisted?{verified:true,targetHash:interactionTargetHash(target),receiptId:'ui-like:'+target.videoId}:{verified:false};
  }};
  interaction=await dispatchInteraction({store:deps.store,adapter,intent,limits:settings.interactionLimits,signal,ownerRequested:true});
  return interaction;
 }})});
 return {...result,allowed:result.allowed&&interaction?.status==='confirmed',interaction,sendingSupported:true,verification:'liked_state_persisted_after_page_reload'};
}
export async function performComment(settings,args,deps){
 return performPublicText(settings,args,deps);
}
export async function performReply(settings,args,deps){
 if(args.confirm!=='publish_one_bound_reply')return {allowed:false,reason:'explicit_bound_reply_required'};
 const state=await deps.store.snapshot(),draft=state.resources.manualDrafts?.find(d=>d.id===args.draftId);
 if(draft?.kind!=='comment'||draft.status!=='copy_only_unsent'||draft.replyTarget?.identityKind!=='dom_fingerprint')return {allowed:false,reason:'unsent_bound_comment_draft_required'};
 const result=await performPublicText(settings,{confirm:args.confirm,sourceRef:draft.replyTarget.sourceRef,text:draft.text,replyTarget:draft.replyTarget},deps);
 if(result.interaction?.attemptId)await deps.store.transact(s=>{
  const d=s.resources.manualDrafts.find(d=>d.id===draft.id);if(d&&d.status==='copy_only_unsent')d.status=result.interaction.status==='confirmed'?'confirmed_sent':result.interaction.status==='not_applied'?'copy_only_unsent':'send_uncertain';
  return {state:s,value:null};
 });
 return result;
}
async function performPublicText(settings,args,deps){
 const reply=args.replyTarget;
 if(args.confirm!==(reply?'publish_one_bound_reply':'publish_one_exact_comment'))return {allowed:false,reason:'explicit_comment_required'};
 const videoId=videoIdFromPage(args.sourceRef),text=args.text;
 if(!videoId)throw Error('Exact approved video required');validatePublicText(settings,text);
 const intent={kind:reply?'reply':'comment',...reply,sourceRef:args.sourceRef,videoId,text};
 const state=await deps.store.snapshot(),ownerRequested=deps.autonomous!==true;
 if(!ownerRequested&&(reply||!state.resources.autonomy?.enabled||state.resources.autonomy.inFlightId!==deps.autonomyLeaseId||!(['comment','comment_or_share_link','comment_or_share_card'].includes(state.resources.autonomy.deliveryMode)||state.resources.autonomy.deliveryMode==='console_preferences'&&videoPreferences(state).commentEnabled)))return {allowed:false,reason:'autonomous_comment_not_enabled',sendingPerformed:false};
 const gate=interactionDecision(state,intent,{limits:settings.interactionLimits,time:(deps.now??Date.now)(),ownerRequested,signal:deps.signal});
 if(!gate.allowed)return {...gate,sendingPerformed:false};
 let interaction;
 const result=await (deps.read??readOneVideo)(settings,{confirm:'read_one_public_video',sourceRef:args.sourceRef},{...deps,run:options=>(deps.run??runSmoke)({...options,inspectInteractionUi:true,openCommentPanel:true,afterReady:async({settings:browserSettings,read,signal})=>{
  const pause=()=> (deps.delay??delay)(300,undefined,{signal});
  let replyBinding;
  if(reply){
   const p=await read(browserSettings,{signal,includeComments:true});
   const c=p.allowed&&p.commentSnapshot?.comments?.find(c=>c.localCommentKey===reply.localCommentKey&&c.authorId===reply.authorId);
   if(!c){interaction={allowed:false,reason:'reply_parent_changed'};return interaction;}
   replyBinding={localCommentKey:c.localCommentKey,authorId:c.authorId,authorName:c.authorName,text:c.text};
  }
  const operation=async phase=>{
   const p=await read(browserSettings,{signal,operation:{phase,videoId,text,...(replyBinding?{replyBinding}:{})}});
   if(!p.allowed||!p.operationResult?.ready)throw Error(p.operationResult?.reason||p.reason||'bound_operation_refused');return p.operationResult;
  };
  const adapter={inspectTarget:async target=>{
   await operation(reply?'click_reply':'click_focus');let p;
   for(let i=0;i<10;i++){p=await operation('inspect');if(p.editorCount===1)break;await pause();}
   return {ready:p.editorCount===1&&p.editorEmpty===true&&p.matchingComments.length===0,targetHash:interactionTargetHash(target)};
  },sendOnce:async target=>{
   const filled=await operation('fill');if(!filled.filled)throw Error('Comment input not verified');
   await operation('click_submit');
   let authorId;
   const initialReceipt=await waitForStableReceipt(()=>operation('receipt'),r=>{
    if(!r.editorEmpty||r.matches.length!==1||!r.matches[0].recent)return false;
    const current=r.matches[0].authorId;
    if(authorId&&authorId!==current)return false;
    authorId=current;return true;
   },{signal,pause:deps.delay??delay,now:deps.monotonicNow});
   if(!initialReceipt)return {verified:false};
   const initial=initialReceipt.matches[0];
   // Re-read from the server through normal page reload; never retry submission.
   try{await operation('refresh');}catch{/* navigation may destroy the old isolated world */}
   let panelOpened=false;
   const persisted=await waitForStableReceipt(async()=>{
    if(signal?.aborted)throw Error('Cancelled');
    try{
     const p=await read(browserSettings,{signal,includeComments:true,openCommentPanel:!panelOpened,operation:{phase:'receipt',videoId,text,...(replyBinding?{replyBinding}:{})}});
     if(p.commentPanelClickPerformed)panelOpened=true;
     const r=p.operationResult;
     return p.allowed&&r?.ready?r:null;
    }catch{signal?.throwIfAborted();return null;}
   },r=>r?.matches?.length===1&&r.matches[0].authorId===initial.authorId,{signal,pause:deps.delay??delay,now:deps.monotonicNow,minimumMs:1000});
   return persisted?{verified:true,targetHash:interactionTargetHash(target),receiptId:'ui-comment:'+commentFingerprint(videoId,initial.authorId,text)}:{verified:false};
  }};
  interaction=await dispatchInteraction({store:deps.store,adapter,intent,limits:settings.interactionLimits,signal,ownerRequested});return interaction;
 }})});
 return {...result,allowed:result.allowed&&interaction?.status==='confirmed',interaction,sendingSupported:true,verification:'visible_comment_persisted_after_page_reload'};
}

import {readOneVideo} from './manual-browser.js';
import {runPublicVideoSession as runSmoke} from './retained-browser.js';
import {videoIdFromPage} from './comment-policy.js';
import {setTimeout as delay} from 'node:timers/promises';

export async function previewOwnerMention(settings,args,deps){
 if(args.confirm!=='preview_owner_mention_without_sending')return {allowed:false,reason:'explicit_mention_preview_required',sendingSupported:false};
 const state=await deps.store.snapshot(),owner=state.resources.ownerIdentity;
 if(owner?.verified!==true||state.resources.persona?.ownerId!==owner.platformId)return {allowed:false,reason:'verified_owner_required',sendingSupported:false};
 const videoId=videoIdFromPage(args.sourceRef);if(!videoId)throw Error('Exact approved video required');
 const text='@'+owner.ownerHandle,mentionOwner={platformId:owner.platformId,handle:owner.ownerHandle};
 let diagnostic,filled=false,cleared=false,clearError;
 const result=await (deps.read??readOneVideo)(settings,{confirm:'read_one_public_video',sourceRef:args.sourceRef},{...deps,run:options=>(deps.run??runSmoke)({...options,inspectInteractionUi:true,openCommentPanel:true,afterReady:async({settings:browserSettings,read,signal})=>{
  const operation=async(phase,query=false)=>{
   const p=await read(browserSettings,{signal,operation:{phase,videoId,...(query?{text,mentionOwner}:{})}});
   if(!p.allowed||!p.operationResult?.ready)throw Error(p.operationResult?.reason||p.reason||'mention_preview_refused');return p.operationResult;
  };
  await operation('click_focus');
  for(let i=0;i<10;i++){const p=await operation('inspect');if(p.editorCount===1&&p.editorEmpty)break;if(i===9)throw Error('Empty composer not ready');await (deps.delay??delay)(300,undefined,{signal});}
  try{
   filled=(await operation('fill',true)).filled===true;
   if(!filled)throw Error('Mention query not verified');
   for(let i=0;i<10;i++){diagnostic=await operation('mention_inspect',true);if(diagnostic.containerCount>0)break;await (deps.delay??delay)(500,undefined,{signal});}
   return {diagnostic,sent:false,selectionPerformed:false};
  }finally{
   // Only clear the exact query we inserted; never erase a user's changed draft.
   if(filled){try{cleared=(await operation('clear',true)).cleared===true;}catch(e){cleared=false;clearError=String(e.message).slice(0,160);}}
  }
 }})});
 return {...result,allowed:result.allowed&&(!filled||cleared),...(filled&&!cleared?{reason:'mention_query_cleanup_not_verified',clearError}:{}),mode:'verified_owner_mention_query_preview',diagnostic,filled,cleared,selectionPerformed:false,sent:false,sendingSupported:false,
  mentionIdentityReady:diagnostic?.verifiedOwnerCandidateCount===1,warning:'Candidate visibility is not a sent mention or a verified structured mention entity.'};
}

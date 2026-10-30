import {readOneVideo} from './manual-browser.js';
import {runPublicVideoSession as runSmoke} from './retained-browser.js';
export async function previewExactReply(settings,args,deps){
 if(args.confirm!=='open_exact_reply_without_sending')return {allowed:false,reason:'explicit_reply_preview_required',sendingSupported:false};
 const state=await deps.store.snapshot(),now=(deps.now??Date.now)();
 if(!Number.isSafeInteger(now)||now<state.lastTime)return {allowed:false,reason:'clock_rollback',sendingSupported:false};
 const draft=state.resources.manualDrafts?.find(q=>q.id===args.draftId),target=draft?.replyTarget;
 if(draft?.kind!=='comment'||target?.identityKind!=='dom_fingerprint')return {allowed:false,reason:'bound_comment_draft_required',sendingSupported:false};
 const result=await (deps.read??readOneVideo)(settings,{confirm:'read_one_public_video',includeComments:true,sourceRef:target.sourceRef},{...deps,
  run:options=>(deps.run??runSmoke)({...options,probeReplyComposer:true,probeReplyKey:target.localCommentKey}),
 });
 return {...result,mode:'exact_reply_composer_preview_only',sendingSupported:false,filled:false,sent:false};
}

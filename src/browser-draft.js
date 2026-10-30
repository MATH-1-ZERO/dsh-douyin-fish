import {readOneVideo} from './manual-browser.js';
import {transition} from './engine.js';

// No provider or Search/Fetch API. One local orchestration call replaces two model tool turns.
export async function readAndPrepareDraft(settings,args,dependencies){
  if(args.draftKind===undefined){
    if(args.recipientHint!==undefined)throw Error('recipientHint requires draftKind');
    return (dependencies.read??readOneVideo)(settings,args,dependencies);
  }
  if(!['comment','mention'].includes(args.draftKind)||typeof(args.recipientHint??'')!=='string'||(args.recipientHint??'').length>100)throw Error('Invalid draft options');
  if(args.confirm!=='read_one_public_video')return {allowed:false,reason:'explicit_read_confirmation_required'};
  if(settings.manualDrafts?.enabled===false)return {allowed:false,reason:'manual_drafts_disabled'};
  if(dependencies.signal?.aborted)throw Error('Cancelled');
  const read=await (dependencies.read??readOneVideo)(settings,args,dependencies);
  if(!read.allowed)return read;
  if(dependencies.signal?.aborted)throw Error('Cancelled');
  const latest=await (dependencies.loadSettings??(async()=>settings))();
  if(latest.manualBrowser?.enabled!==true)return {allowed:false,reason:'manual_browser_disabled_after_read',checks:read.checks,sendingSupported:false};
  const preparation=await dependencies.store.transact(state=>{
    if(dependencies.signal?.aborted)throw Error('Cancelled');
    return transition(latest,state,'manual_prepare',{kind:args.draftKind,material:read.untrustedMaterial.text,
      sourceRef:read.untrustedMaterial.sourceRef,recipientHint:args.recipientHint??''},(dependencies.now??Date.now)());
  });
  // Caption is included once inside preparation.payload.untrustedInput, never copied into a second field.
  return {allowed:preparation.allowed,mode:'on_demand_draft_preparation',sourceRef:read.untrustedMaterial.sourceRef,
    checks:read.checks,readReservationsUsed:read.readReservationsUsed,readReservationsLimit:read.readReservationsLimit,
    draftPreparation:preparation,sendingSupported:false,
    next:!preparation.allowed?'stop':preparation.cacheHit?'show_cached_draft':'write_one_draft_then_call_fish_manual_finish'};
}

import {mkdir,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {loadRetainedLease,runOwnerProfileSession,withOwnerUiPage} from './retained-browser.js';
import {ownerPublicProofExpression} from './live-browser/owner-public-proof.mjs';
import {reserveBrowserStage} from './browser-workflow.js';

export function ownerBindingInput(args){
 if(args?.confirm!=='bind_owner_from_public_profile')throw Error('explicit_owner_binding_required');
 const expression=ownerPublicProofExpression(args.sourceRef,args.ownerHandle);
 return {expression,platformId:new URL(args.sourceRef).pathname.split('/').at(-1),sourceRef:args.sourceRef,ownerHandle:args.ownerHandle};
}
const stopped=s=>s.paused&&!s.resources.ownerReplies?.enabled&&!s.resources.autonomy?.enabled&&!s.resources.conversationReplies?.enabled;
export async function bindOwner(settings,args,deps){
 const target=ownerBindingInput(args),{store,signal}=deps;
 const first=await store.snapshot();if(!first.resources.persona)return {allowed:false,reason:'import_persona_first'};
 if(!stopped(first))return {allowed:false,reason:'pause_before_owner_binding'};
 if(first.resources.ownerIdentity?.verified&&(first.resources.ownerIdentity.platformId!==target.platformId||first.resources.ownerIdentity.ownerHandle!==target.ownerHandle))return {allowed:false,reason:'different_owner_already_bound'};
 const lease=await (deps.loadLease??loadRetainedLease)();if(!lease)return {allowed:false,reason:'dedicated_browser_binding_required'};await lease.verify(signal);
 await mkdir(store.directory,{recursive:true});const lock=join(store.directory,'.manual-browser-running');
 try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')return {allowed:false,reason:'browser_busy_or_stale_lock'};throw e;}
 try{
  const reserved=await reserveBrowserStage(settings,store,undefined,Date.now());if(!reserved.allowed)return reserved;
  const report=await (deps.profileRunner??runOwnerProfileSession)(target.sourceRef,async({signal})=>{
   let previous,stable=0;
   for(let i=0;i<150;i++){
    signal?.throwIfAborted();
    const proof=await (deps.withUiPage??withOwnerUiPage)(target.sourceRef,async({session,sessionId,contextId})=>{
     const result=await session.send('Runtime.evaluate',{contextId,expression:target.expression,returnByValue:true,timeout:1000},sessionId);
     if(result.exceptionDetails)throw Error('owner_profile_read_failed');return result.result?.value;
    },{signal});
    if(proof?.ready&&proof.profileHandleVerified===true&&proof.ownerName&&proof.avatarResource){const key=JSON.stringify(proof);stable=key===previous?stable+1:1;previous=key;if(stable>=2)return proof;}else stable=0;
    await (deps.delay??delay)(500,undefined,{signal});
   }
   throw Error('owner_profile_not_verified');
  },{signal,reloadIfSame:false});
  if(!report.success)return {allowed:false,reason:report.error??'owner_profile_not_verified',sendingPerformed:false};
  signal?.throwIfAborted();
  return store.transact(s=>{
   signal?.throwIfAborted();if(!stopped(s)||!s.resources.persona)throw Error('owner_binding_state_changed');
   if(JSON.stringify(s.resources.ownerIdentity)!==JSON.stringify(first.resources.ownerIdentity))throw Error('owner_binding_state_changed');
   const proof=report.result;if(!proof?.profileHandleVerified||!proof.ownerName||!proof.avatarResource)throw Error('owner_profile_not_verified');
   s.resources.ownerIdentity={verified:true,platformId:target.platformId,ownerHandle:target.ownerHandle,verifiedAt:Date.now(),verificationMethod:'exact_public_profile_handle_and_avatar'};
   s.resources.persona.ownerId=target.platformId;
   return {state:s,value:{allowed:true,ownerName:proof.ownerName,identityVerified:true,paused:true,sendingPerformed:false}};
  });
 }finally{await rmdir(lock);}
}

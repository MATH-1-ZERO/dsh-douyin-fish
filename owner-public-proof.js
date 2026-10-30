import {mkdir,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {runOwnerProfileSession as runProfileSession,withOwnerUiPage as withUiPage} from './retained-browser.js';
import {ownerPublicProofExpression} from './live-browser/owner-public-proof.mjs';
import {reserveBrowserRead} from './manual-browser.js';
import {reserveBrowserStage} from './browser-workflow.js';
export async function readOwnerPublicProof(settings,deps){
 const s=await deps.store.snapshot(),owner=s.resources.ownerIdentity;
 if(owner?.verified!==true||s.resources.persona?.ownerId!==owner.platformId)return {allowed:false,reason:'verified_owner_required'};
 const profile='https://www.douyin.com/user/'+owner.platformId;
 await mkdir(deps.store.directory,{recursive:true});const lock=join(deps.store.directory,'.manual-browser-running');
 try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')return {allowed:false,reason:'browser_busy_or_stale_lock'};throw e;}
 try{
  const reservation=await reserveBrowserStage(settings,deps.store,deps.browserWorkflow,(deps.now??Date.now)());if(!reservation.allowed)return reservation;
  const report=await (deps.profileRunner??runProfileSession)(profile,async({signal})=>{
   let last,stable=0;
   // The real Douyin profile page publishes its title late (observed 30s-90s), so
   // the binding needs a budget of minutes, not seconds.
   for(let i=0;i<150;i++){
    const r=await (deps.withUiPage??withUiPage)(profile,async({session,sessionId,contextId})=>{const r=await session.send('Runtime.evaluate',{contextId,expression:ownerPublicProofExpression(profile,owner.ownerHandle),returnByValue:true,timeout:1000},sessionId);if(r.exceptionDetails)throw Error('Public owner binding refused');return r.result?.value;},{signal}).catch(()=>null);
    if(r?.ready){const key=JSON.stringify(r);stable=key===last?stable+1:1;last=key;if(stable>=2)return {...r,ownerId:owner.platformId,ownerHandle:owner.ownerHandle,verifiedAt:Date.now()};}else stable=0;
    await (deps.delay??delay)(500,undefined,{signal});
   }
   throw Error('Public owner profile/asset binding not stable');
  },{signal:deps.signal});
  return {allowed:report.success===true,reason:report.error,proof:report.success?report.result:undefined,checks:{bindingVerified:report.bindingVerified,ownBrowserStopped:report.ownBrowserStopped,portReleased:report.portReleased,browserRetained:report.browserRetained,sessionReleased:report.sessionReleased}};
 }finally{await rmdir(lock);}
}

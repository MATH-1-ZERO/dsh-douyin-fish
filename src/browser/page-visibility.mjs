import {setTimeout as delay} from 'node:timers/promises';

// Bringing a tab forward acknowledges the command before visibilitychange may
// reach its renderer. Wait in the same verified scope; never click or navigate.
export async function ensurePageVisible({inspect,bringToFront,wait=delay,signal,now=()=>performance.now(),timeoutMs=3000}){
 if(typeof inspect!=='function'||typeof bringToFront!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<0)throw Error('Invalid page visibility check');
 const started=now();let last,foregroundAttempted=false;
 const elapsed=()=>Math.max(0,now()-started);
 const result=(ready,reason=null)=>({ready,reason,pageVisible:last?.pageVisible===true,foregroundAttempted,waitMs:elapsed()});
 const observe=async()=>{
  signal?.throwIfAborted();last=await inspect();signal?.throwIfAborted();
  if(last?.ready!==true)return result(false,last?.reason||'owner_dm_visibility_unavailable');
  if(last.pageVisible===true)return result(true);
  if(last.pageVisible!==false)return result(false,'owner_dm_visibility_unavailable');
  return null;
 };
 const first=await observe();if(first)return first;
 if(elapsed()>=timeoutMs)return result(false,'owner_dm_page_hidden');
 foregroundAttempted=true;
 signal?.throwIfAborted();await bringToFront();signal?.throwIfAborted();
 // The count bound also terminates tests or faulty clocks that do not advance.
 const maxPolls=Math.max(1,Math.min(1000,Math.ceil(timeoutMs/100)+1));
 for(let i=0;i<maxPolls&&elapsed()<timeoutMs;i++){
  const observed=await observe();if(observed)return observed;
  if(elapsed()>=timeoutMs)break;
  await wait(Math.min(100,timeoutMs-elapsed()),undefined,{signal});
  signal?.throwIfAborted();
 }
 return result(false,'owner_dm_page_hidden');
}

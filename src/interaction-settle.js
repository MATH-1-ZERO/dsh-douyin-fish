import {setTimeout as delay} from 'node:timers/promises';

// An optimistic bubble/heart is not a persisted receipt. Keep the page alive
// before any reload, then require independent observations after that reload.
export async function waitForStableReceipt(read,accept,{signal,pause=delay,now=()=>performance.now(),minimumMs=10000,timeoutMs=20000}={}){
 const started=now();let stable=0;
 for(let i=0;i<Math.ceil(timeoutMs/500)+1;i++){
  signal?.throwIfAborted();
  const value=await read();
  stable=accept(value)?stable+1:0;
  const elapsed=now()-started;
  if(stable>=3&&elapsed>=minimumMs)return value;
  if(elapsed>=timeoutMs)return null;
  await pause(500,undefined,{signal});
 }
 return null;
}

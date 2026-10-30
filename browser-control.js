import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {plan,listListeners,chooseBrowser,prepareProfile,stopOwnBrowser} from './live-browser/browser-smoke.mjs';
import {adoptRetainedBrowser,retainedBrowserStatus,loadRetainedLease} from './retained-browser.js';

// Explicit console gesture only. Never install a browser or attach to a personal profile.
export async function prepareDedicatedBrowser({signal,io={}}={}){
 const deps={listListeners,chooseBrowser,prepareProfile,stopOwnBrowser,adoptRetainedBrowser,retainedBrowserStatus,loadRetainedLease,delay,...io};
 signal?.throwIfAborted();
 const bindings=await deps.listListeners();let child;
 try{
  if(!bindings.length){
   const p=plan();await deps.prepareProfile(p.profile);signal?.throwIfAborted();
   const executable=await deps.chooseBrowser();
   child=(io.launch??((exe,args)=>spawn(exe,args,{detached:true,stdio:'ignore',windowsHide:false})))(executable,[
    '--user-data-dir='+p.profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--enable-automation','--no-first-run','--disable-sync','--new-window','https://www.douyin.com/']);
   if(!io.launch)await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
   let bound=false;
   for(let i=0;i<40;i++){
    signal?.throwIfAborted();const current=await deps.listListeners();
    if(current.length){if(current.length!==1||current[0].pid!==child.pid||current[0].address!=='127.0.0.1')throw Error('unexpected_browser_listener');bound=true;break;}
    await deps.delay(250,undefined,{signal});
   }
   if(!bound)throw Error('dedicated_browser_start_timeout');
  }
  signal?.throwIfAborted();
  const adopted=await deps.adoptRetainedBrowser('reuse_this_dedicated_edge');
  if(!adopted.allowed)throw Error(adopted.reason);
  const status=await deps.retainedBrowserStatus();if(!status.bindingVerified)throw Error(status.reason||'dedicated_browser_binding_required');
  child?.unref?.();
  return {allowed:true,opened:!!child,reconnected:!child,browser:status,sendingPerformed:false};
 }catch(error){if(child)await deps.stopOwnBrowser(child);return {allowed:false,reason:error.message,sendingPerformed:false};}
}

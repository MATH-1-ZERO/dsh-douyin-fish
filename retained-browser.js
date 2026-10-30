import {windowsPaths} from './windows-paths.js';
import {setTimeout as delay} from 'node:timers/promises';
import {videoIdFromPage} from './comment-policy.js';
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {resolve,join} from 'node:path';import {homedir} from 'node:os';import {randomUUID} from 'node:crypto';
import {connect,readTestPage} from './live-browser/browser-read.js';
import {plan,listListeners,runSmoke} from './live-browser/browser-smoke.mjs';
import {profilePage,runProfileSession,withUiPage} from './live-browser/scoped-ui.mjs';
import {approvedVideoPage} from './live-browser/route-policy.mjs';
import {pageRestriction} from './live-browser/page-restriction.mjs';
const exec=promisify(execFile),endpoint='http://127.0.0.1:9222';
const recordPath=()=>join(homedir(),'.dsh','douyin-fish-local','.retained-browser.json');
export function validateBrowserRecord(r){
 if(!r||r.version!==1||!Number.isSafeInteger(r.pid)||r.pid<=0||typeof r.created!=='string'||!Number.isFinite(Date.parse(r.created))||!/^[-A-Za-z0-9_]{5,100}$/.test(r.browserId||'')||!/^[-A-Za-z0-9_]{5,200}$/.test(r.targetId||'')||Object.keys(r).some(k=>!['version','pid','created','browserId','targetId'].includes(k)))throw Error('Invalid retained browser record');return r;
}
export function verifyBrowserArguments(args){
 const one=k=>{const a=args?.filter(x=>x===k||x.startsWith(k+'='));return a?.length===1&&a[0].startsWith(k+'=')?a[0].slice(k.length+1):null;};
 if(!Array.isArray(args)||!args.every(x=>typeof x==='string')||!args.includes('--enable-automation')||one('--remote-debugging-address')!=='127.0.0.1'||one('--remote-debugging-port')!=='9222'||resolve(one('--user-data-dir')||'.').toLowerCase()!==resolve(plan().profile).toLowerCase()||args.some(x=>/^--(?:incognito|inprivate)(?:=|$)/i.test(x)))throw Error('Dedicated retained browser arguments refused');
}
export async function processIdentity(pid){
 if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid browser PID');
 const script=`$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop; if (!$p) { throw 'Browser process missing' }; [pscustomobject]@{ executable=$p.ExecutablePath; created=$p.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress`;
 const {stdout}=await exec(windowsPaths().powershell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:5000,maxBuffer:4096});
 const p=JSON.parse(stdout),allowed=plan().browserCandidates.map(x=>resolve(x).toLowerCase());
 if(!allowed.includes(resolve(p.executable||'.').toLowerCase())||!Number.isFinite(Date.parse(p.created)))throw Error('Unexpected browser process identity');return p;
}
export function retainedRoute(value){
 try{const u=new URL(value);return !!(approvedVideoPage(value)||profilePage(value)||u.origin==='https://www.douyin.com'&&u.pathname==='/'&&!u.username&&!u.password&&!u.hash&&(!u.search||u.search==='?recommend=1'));}catch{return false;}
}
export function navigateExpression(from,to){
 if(!retainedRoute(from)||!retainedRoute(to))throw Error('Retained navigation only permits public Douyin routes');
 return `(()=>{if(location.href!==${JSON.stringify(from)})return {ready:false,reason:'retained_page_changed'};const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};const fields=[...document.querySelectorAll('[contenteditable="true"],textarea,input[type="text"]')].filter(visible);if(fields.some(e=>(e.value||e.innerText||'').replace(/[\\u200B\\uFEFF]/g,'').trim()))return {ready:false,reason:'existing_input_preserved'};const restriction=(${pageRestriction.toString()})();if(restriction)return {ready:false,reason:'manual_'+restriction+'_required'};location.assign(${JSON.stringify(to)});return {ready:true,navigated:true};})()`;
}
export async function buildRetainedLease(record,deps={}){
 validateBrowserRecord(record);const listeners=deps.listListeners??listListeners,identity=deps.processIdentity??processIdentity,connection=deps.connect??connect;
 const checkedConnect=async(_settings={endpoint},signal)=>{
  const b=await listeners();if(b.length!==1||b[0].pid!==record.pid||b[0].address!=='127.0.0.1')throw Error('Retained browser listener changed');
  const p=await identity(record.pid);if(p.created!==record.created)throw Error('Retained browser PID reused');
  const c=await connection({endpoint},signal);
  try{if(c.browserId!==record.browserId)throw Error('Retained browser instance changed');verifyBrowserArguments((await c.send('Browser.getBrowserCommandLine')).arguments);return c;}catch(e){c.close();throw e;}
 };
 const verify=async(signal)=>{const c=await checkedConnect({endpoint},signal);try{const pages=(await c.send('Target.getTargets')).targetInfos.filter(t=>t.type==='page');if(pages.length!==1||pages[0].targetId!==record.targetId||!retainedRoute(pages[0].url))throw Error('Retained tab changed, private, or ambiguous');return pages[0];}finally{c.close();}};
 return {pid:record.pid,verify,connect:checkedConnect,read:(settings,options)=>readTestPage(settings,options,{connect:checkedConnect}),navigate:async (target,{reloadIfSame=false}={})=>{
  if(!retainedRoute(target))throw Error('Invalid retained destination');const page=await verify();if(page.url===target&&!reloadIfSame)return;
  const c=await checkedConnect();try{
   const {sessionId}=await c.send('Target.attachToTarget',{targetId:record.targetId,flatten:true}),frame=(await c.send('Page.getFrameTree',{},sessionId)).frameTree.frame;
   if(frame.url!==page.url)throw Error('Retained main frame changed');
   const {executionContextId}=await c.send('Page.createIsolatedWorld',{frameId:frame.id,worldName:'fish-retained-navigation'},sessionId);
   const r=await c.send('Runtime.evaluate',{contextId:executionContextId,expression:navigateExpression(page.url,target),returnByValue:true,timeout:1000,userGesture:true},sessionId);
   if(r.exceptionDetails||!r.result?.value?.ready)throw Error(r.result?.value?.reason||'Retained navigation refused');
  }finally{c.close();}
 }};
}
export async function loadRetainedLease(){let r;try{r=JSON.parse(await readFile(recordPath(),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}return buildRetainedLease(r);}
export async function adoptRetainedBrowser(confirm){
 if(confirm!=='reuse_this_dedicated_edge')return {allowed:false,reason:'explicit_browser_adoption_required'};
 const bindings=await listListeners();if(bindings.length!==1||bindings[0].address!=='127.0.0.1')return {allowed:false,reason:'one_loopback_dedicated_browser_required'};
 const p=await processIdentity(bindings[0].pid),c=await connect({endpoint});let r;
 try{verifyBrowserArguments((await c.send('Browser.getBrowserCommandLine')).arguments);const pages=(await c.send('Target.getTargets')).targetInfos.filter(t=>t.type==='page');if(pages.length!==1||!retainedRoute(pages[0].url))throw Error('Keep one public Douyin tab for adoption');r=validateBrowserRecord({version:1,pid:bindings[0].pid,created:p.created,browserId:c.browserId,targetId:pages[0].targetId});}finally{c.close();}
 await (await buildRetainedLease(r)).verify();const temporary=recordPath()+'.'+randomUUID();await writeFile(temporary,JSON.stringify(r),{flag:'wx',mode:0o600});await rename(temporary,recordPath());return {allowed:true,pid:r.pid,browserRetained:true,automaticSendingEnabled:false};
}
export async function releaseRetainedBrowser(confirm){if(confirm!=='release_retained_browser_without_closing')return {allowed:false,reason:'explicit_release_required'};try{await unlink(recordPath());}catch(e){if(e.code!=='ENOENT')throw e;}return {allowed:true,browserClosed:false};}
export async function retainedBrowserStatus(){try{const lease=await loadRetainedLease();if(!lease)return {configured:false,liveChecked:false};await lease.verify();return {configured:true,liveChecked:true,bindingVerified:true,pid:lease.pid,browserRetained:true};}catch(e){return {configured:true,liveChecked:true,bindingVerified:false,reason:e.message};}}
export async function advanceRetainedVideo(lease,options={},wait=delay,now=()=>performance.now()){
 options.signal?.throwIfAborted();
 const before=await lease.verify(options.signal),id=videoIdFromPage(before.url);
 options.signal?.throwIfAborted();
 if(!id)return options;
 let scrollError;
 try{
  const r=await lease.read({browser:{enabled:true,endpoint}},{signal:options.signal,operation:{phase:'advance_one_video',videoId:id}});
  if(!r.allowed||!r.operationResult?.ready){const e=Error(r.reason||r.operationResult?.reason||'Public video scroll refused');e.actionNotApplied=true;throw e;}
 }catch(e){
  // A known pre-wheel refusal is not an ambiguous wheel result.
  if(e.actionNotApplied||!/timed?\s*out|timeout/i.test(e.message))throw e;
  scrollError=e.message;
 }
 // Some pages update their URL asynchronously. Only read after the one wheel;
 // never send another wheel, click, key or navigation as a fallback.
 const deadline=now()+15000;
 for(let i=0;i<60&&now()<deadline;i++){
  options.signal?.throwIfAborted();
  await wait(Math.min(250,deadline-now()),undefined,{signal:options.signal});
  if(now()>=deadline)break;
  const controller=new AbortController(),signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
  let timer,onAbort,p;
  try{
   p=await Promise.race([lease.verify(signal),new Promise((_,reject)=>{
    onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});
    if(signal.aborted)onAbort();
    timer=setTimeout(()=>controller.abort(Error('Retained video verification deadline exceeded')),Math.max(0,deadline-now()));
   })]);
  }catch(e){options.signal?.throwIfAborted();if(controller.signal.aborted)break;throw e;}
  finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
  options.signal?.throwIfAborted();
  if(now()>=deadline)break;
  if(videoIdFromPage(p.url)&&videoIdFromPage(p.url)!==id)return {...options,sourceRef:p.url,advanceVerifiedAfterSingleAttempt:true,...(scrollError?{scrollCommandReceiptError:scrollError}:{})};
 }
 throw Error('Single scroll did not yield a different bound video; no repeat'+(scrollError?'; command receipt: '+scrollError:''));
}
// Retained reads must target the approved jingxuan page through the same
// verified lease; owner browsing settings never widen this destination.
export function retainedWatchRead(lease){return (_settings,options)=>lease.read({browser:{enabled:true,endpoint}},options);}
export async function runPublicVideoSession(options){
 const lease=await loadRetainedLease();
 if(lease&&options.advanceVideo&&!options.sourceRef){
  options=await advanceRetainedVideo(lease,options);
 }
 return runSmoke(options,lease?{reuseLease:lease,read:lease.read}:{});
}
export async function runOwnerProfileSession(target,callback,options={}){const lease=await loadRetainedLease();return runProfileSession(target,callback,lease?{...options,io:{...options.io,reuseLease:lease}}:options);}
export async function withOwnerUiPage(target,callback,options={}){const lease=await loadRetainedLease();return withUiPage(target,callback,lease?{...options,connection:lease.connect}:options);}

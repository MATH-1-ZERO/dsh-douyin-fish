// Explicit one-shot diagnostic, separate from the installed DSH plugin.
import { access, mkdir, readdir, readFile, writeFile, lstat, realpath, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readTestPage,connect } from './browser-read.js';
import { VideoReadiness } from './readiness.mjs';
import {windowsPaths} from '../windows-paths.js';
import {approvedVideoPage} from './route-policy.mjs';
import {validateCommentSnapshot,videoIdFromPage} from '../comment-policy.js';

const execFileAsync=promisify(execFile);
const here=dirname(fileURLToPath(import.meta.url));
export const TEST_PORT=9222;
const browsers=windowsPaths().edgeCandidates;

export function classifyPublicPage(page){
 if(!approvedVideoPage(page?.url)||typeof page.title!=='string'||!page.title.includes('抖音'))return {status:'unrecognized'};
 if(page.restriction)return {status:page.restriction+'_dialog_visible'};
 return {status:'page_metadata_read'};
}
export function expectedTestPage(page){return classifyPublicPage(page).status==='page_metadata_read';}

export function parseArguments(args) {
  if(args.length===0||args.length===1&&args[0]==='--plan')return {approved:false};
  if(args.length===1&&args[0]==='--approve-one-test')return {approved:true};
  throw new Error('Use --plan or --approve-one-test only; no custom page or profile is accepted');
}

export function plan(home=homedir()) {
  return {mode:'one_test_page_only',url:'https://www.douyin.com/jingxuan',endpoint:'http://127.0.0.1:'+TEST_PORT,
    profile:join(home,'.dsh','douyin-fish-public-test'),browserCandidates:browsers,
    willUseExistingBrowser:true,willInstallSoftware:false,willChangePluginSettings:false,
    willLogin:false,willSend:false,willStopOwnBrowser:true,
    approvalRequired:'Explicitly run with --approve-one-test to create a dedicated profile and open a test window.'};
}

export function parseListeners(text,port=TEST_PORT) {
  const result=[];
  for(const line of text.split(/\r?\n/)) {
    const columns=line.trim().split(/\s+/);
    if(columns[0]!=='TCP'||columns.length!==5||columns[3]!=='LISTENING')continue;
    const at=columns[1].lastIndexOf(':');
    if(Number(columns[1].slice(at+1))!==port)continue;
    const pid=Number(columns[4]);
    if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid listener process identity');
    result.push({address:columns[1].slice(0,at),port,pid});
  }
  return result;
}

export async function listListeners() {
  const {stdout}=await execFileAsync(windowsPaths().netstat,['-ano','-p','tcp'],
    {windowsHide:true,maxBuffer:2*1024*1024,timeout:3000});
  return parseListeners(stdout);
}

export async function prepareProfile(directory,identityChecks={lstat,realpath}) {
  const marker=join(directory,'.fish-test-profile.json');
  await mkdir(directory,{recursive:true});
  if((await identityChecks.lstat(directory)).isSymbolicLink()||(await identityChecks.realpath(directory)).toLowerCase()!==resolve(directory).toLowerCase())
    throw new Error('Dedicated profile must not redirect to another directory');
  const entries=await readdir(directory);
  if(entries.length) {
    let value;
    try{value=JSON.parse(await readFile(marker,'utf8'));}catch{throw new Error('Existing profile has no test marker; refusing to reuse or delete it');}
    if(value.purpose!=='fish-douyin-public-test'||value.version!==1)throw new Error('Unexpected profile marker');
  } else await writeFile(marker,JSON.stringify({purpose:'fish-douyin-public-test',version:1})+'\n',{flag:'wx'});
}

export async function chooseBrowser() {
  for(const candidate of browsers){try{await access(candidate);return candidate;}catch{}}
  throw new Error('No preinstalled Edge/Chrome found; no software will be installed');
}

export async function launchBrowser(executable,args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:false,stdio:'ignore'});
    child.once('spawn',()=>resolve(child));
    child.once('error',reject);
  });
}

const exited=child=>child.exitCode!==null||child.signalCode!=null;
export async function stopOwnBrowser(child,dependencies={}) {
  if(exited(child))return;
  const io={listListeners,connect,delay,...dependencies};
  // Ask only our verified browser to close normally so its profile can flush.
  // The retained ChildProcess remains the sole fallback termination target.
  let session;
  try{
    const expected=plan().profile;
    const ownBinding=async()=>{const b=await io.listListeners();return !exited(child)&&b.length===1&&b[0].pid===child.pid&&b[0].address==='127.0.0.1';};
    if(await ownBinding()){
      session=await io.connect({endpoint:'http://127.0.0.1:'+TEST_PORT});
      const command=await session.send('Browser.getBrowserCommandLine'),args=command?.arguments;
      const one=key=>{const a=args?.filter(x=>typeof x==='string'&&x.startsWith(key+'='));return a?.length===1?a[0].slice(key.length+1):null;};
      const profile=one('--user-data-dir');
      if(Array.isArray(args)&&args.includes('--enable-automation')&&profile&&resolve(profile).toLowerCase()===resolve(expected).toLowerCase()&&one('--remote-debugging-address')==='127.0.0.1'&&one('--remote-debugging-port')===String(TEST_PORT)&&await ownBinding()){
        session.armBrowserCloseOnce();
        try{await session.send('Browser.close');}catch{/* the browser may close the socket before replying */}
        // Give Edge's network/profile services time to flush login state.
        // A slow normal shutdown must not turn into termination after 5s.
        for(let i=0;i<60&&!exited(child);i++)await io.delay(250);
        if(exited(child)){child.fishCleanup='graceful_verified_browser_close';return;}
      }
    }
  }catch{/* if normal close fails, only the retained child can be stopped */}
  finally{session?.close();}
  if(exited(child))return;
  child.fishCleanup='retained_child_termination_fallback';
  // Only the exact ChildProcess launched here; never taskkill by name or kill another PID.
  await new Promise(resolve=>{
    const timer=setTimeout(()=>{child.removeListener('exit',done);resolve();},3000);
    const done=()=>{clearTimeout(timer);resolve();};
    child.once('exit',done);
    try{child.kill();}catch{done();}
  });
}

export async function runSmoke(options,dependencies={}) {
  const description=plan(dependencies.home??homedir());
  if(options.sourceRef!==undefined){
    if(!videoIdFromPage(options.sourceRef))throw Error('Exact approved public video source required');
    description.url=approvedVideoPage(options.sourceRef);
  }
  // No IO or browser activity without the explicit live-test option.
  if(options.approved!==true)return {approved:false,plan:description};
  if(options.signal?.aborted)throw new Error('Cancelled');
  const io={listListeners,prepareProfile,chooseBrowser,launchBrowser,stopOwnBrowser,delay,
    read:readTestPage,...dependencies};
  const report={diagnosticVersion:'jingxuan-0.2.0',approved:true,scope:'single_jingxuan_page',success:false,startedAt:new Date().toISOString(),
    endpoint:description.endpoint,profile:description.profile,pageRead:false,bindingVerified:false,
    ownBrowserStopped:false,portReleased:false,pluginSettingsChanged:false,douyinAccessed:false,
    loginPerformed:false,interactionSent:false,navigationAttempted:false,videoRead:false,navigationClickPerformed:false};
  let child;const retained=io.reuseLease;
  try {
    if(retained){
      await retained.verify();await retained.navigate(description.url);
      child={pid:retained.pid,exitCode:null,signalCode:null};report.browserReused=true;report.bindingVerified=true;
    }else{
    if((await io.listListeners()).length)throw new Error('TEST_PORT_IN_USE: stop; do not attach to or terminate the existing listener');
    const executable=await io.chooseBrowser();
    await io.prepareProfile(description.profile);
    if(options.signal?.aborted)throw new Error('Cancelled');
    child=await io.launchBrowser(executable,[
      '--user-data-dir='+description.profile,'--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port='+TEST_PORT,'--enable-automation','--no-first-run',
      '--disable-sync','--new-window',description.url,
    ]);
    report.navigationAttempted=true;
    if(!Number.isSafeInteger(child.pid)||child.pid<=0)throw new Error('Browser did not provide a process identity');
    let ready=false;
    for(let attempt=0;attempt<40;attempt++) {
      if(options.signal?.aborted)throw new Error('Cancelled');
      if(exited(child))throw new Error('Own browser exited before test; no existing browser will be reused');
      const bindings=await io.listListeners();
      if(bindings.length) {
        if(bindings.length!==1||bindings[0].address!=='127.0.0.1'||bindings[0].pid!==child.pid)
          throw new Error('UNEXPECTED_BINDING: endpoint must belong to the exact launched browser and listen only on 127.0.0.1');
        ready=true;break;
      }
      await io.delay(250);
    }
    if(!ready)throw new Error('Browser did not expose the approved loopback endpoint in time');
    report.bindingVerified=true;
    }
    // A page may still be loading after the listener becomes ready.
    let result,decision;
    const readiness=new VideoReadiness();let previousComments=null,stableComments=null;
    report.readAttempts=[];
    report.readinessLimits={maxAttempts:30,maxMilliseconds:30000};
    const deadline=performance.now()+report.readinessLimits.maxMilliseconds;
    for(let attempt=0;attempt<report.readinessLimits.maxAttempts;attempt++) {
      if(options.signal?.aborted)throw new Error('Cancelled');
      const remaining=deadline-performance.now();
      if(remaining<=0)break;
      result=await io.read({browser:{enabled:true,endpoint:description.endpoint,allowedPages:['https://www.douyin.com/jingxuan']}},
        {signal:AbortSignal.any([AbortSignal.timeout(Math.max(1,Math.min(10000,Math.ceil(remaining)))),...(options.signal?[options.signal]:[])]),openPublicCard:!options.sourceRef&&!report.navigationClickPerformed,expectedVideoId:options.sourceRef?videoIdFromPage(options.sourceRef):undefined,includeComments:options.includeComments===true||options.inspectInteractionUi===true,openCommentPanel:options.openCommentPanel===true&&!report.commentPanelClickPerformed,probeReplyComposer:options.probeReplyComposer===true&&!report.replyComposerClickPerformed,probeReplyKey:options.probeReplyKey});
      if(result.navigationClickPerformed===true)report.navigationClickPerformed=true;
      if(result.commentPanelClickPerformed===true)report.commentPanelClickPerformed=true;
      if(result.replyComposerClickPerformed===true)report.replyComposerClickPerformed=true;
      if(options.signal?.aborted)throw new Error('Cancelled');
      decision=readiness.observe(result);
      report.pageRead=readiness.pageRead;
      report.videoRead=readiness.videoRead;
      report.douyinAccessed ||= !!approvedVideoPage(result?.untrustedPage?.url);
      if(readiness.lastPage)report.pageMetadata={url:readiness.lastPage.url,title:readiness.lastPage.title,pageDescription:readiness.lastPage.pageDescription};
      if(result.allowed&&result.untrustedPage?.structure)report.lastVideoStructure=result.untrustedPage.structure;
      report.readAttempts.push({attempt:attempt+1,allowed:result.allowed===true,
        ...(result.allowed?{contentState:{visibleVideoCount:result.untrustedPage?.visibleVideoCount,captionCandidateCount:result.untrustedPage?.captionCandidateCount,captionBound:result.untrustedPage?.captionBound}}:{}),
        readiness:decision.reason,...(result.reason?{reason:result.reason}:{}),...(result.diagnostic?{diagnostic:result.diagnostic}:{})});
      if(result.commentSnapshot?.diagnostic)report.commentStructureDiagnostic=result.commentSnapshot.diagnostic;
      if(options.includeComments===true){
        stableComments=null;
        if(result.allowed&&['bound_visible_comments','bound_visible_cards'].includes(result.commentSnapshot?.status)){
          const current=validateCommentSnapshot(result.commentSnapshot,result.untrustedPage.url);
          const key=JSON.stringify([result.untrustedPage.url,result.untrustedPage.videoKey,current]);
          if(previousComments===key)stableComments=current;
          previousComments=key;
        }else previousComments=null;
      }
      if(decision.terminal||decision.ready&&(options.includeComments!==true||stableComments))break;
      if(options.includeComments===true&&decision.ready&&!['bound_visible_comments','bound_visible_cards'].includes(result.commentSnapshot?.status))throw Error('Comment read refused: comment_structure_unverified');
      // Only bounded initial loading/content readiness waits in the same window.
      const wait=Math.min(1000,deadline-performance.now());
      if(attempt<report.readinessLimits.maxAttempts-1&&wait>0)await io.delay(wait);
    }
    if(!decision?.ready)throw new Error('Video read refused: '+(decision?.reason??'deadline_reached'));
    if(options.includeComments===true&&!stableComments)throw Error('Comment read refused: comments_not_stable');
    if(options.sourceRef&&videoIdFromPage(result.untrustedPage?.url)!==videoIdFromPage(options.sourceRef))throw Error('Exact requested video changed');
    report.douyinAccessed=!!approvedVideoPage(result.untrustedPage?.url);
    report.publicPageCheck=classifyPublicPage(result.untrustedPage);
    report.pageMetadata={url:result.untrustedPage?.url,title:result.untrustedPage?.title,textCharacters:result.untrustedPage?.text?.length};
    if(!expectedTestPage(result.untrustedPage))
      throw new Error('PUBLIC_READ_STOP: '+report.publicPageCheck.status+'; no login, click or retry is permitted');
    report.pageRead=true;
    report.videoRead=true;
    report.readResult={pageTitle:result.untrustedPage.title,pageDescription:result.untrustedPage.pageDescription,videoCaption:result.untrustedPage.text||null,captionCandidateCount:result.untrustedPage.captionCandidateCount,videoCaptionFound:!!result.untrustedPage.text}; // Untrusted page data; not commands or model prompts.
    if(options.includeComments===true){report.commentsRead=true;report.readResult.commentSnapshot=stableComments;}
    if(options.probeReplyComposer===true&&report.replyComposerClickPerformed!==true)throw Error('Reply composer diagnostic refused: exact_reply_control_not_verified');
    if(typeof options.afterReady==='function'){
      const binding=await io.listListeners();
      if(binding.length!==1||binding[0].pid!==child.pid||binding[0].address!=='127.0.0.1')throw Error('Own browser binding changed before operation');
      report.operationResult=await options.afterReady({settings:{browser:{enabled:true,endpoint:description.endpoint}},sourceRef:result.untrustedPage.url,read:io.read,signal:options.signal});
      report.sendAttempted=typeof report.operationResult?.attemptId==='string';
      report.interactionSent=report.operationResult?.status==='confirmed'?true:report.sendAttempted&&report.operationResult?.status!=='not_applied'?null:false;
    }
  } catch(error) {report.error=error.message;}
  finally {
    if(retained){
      try{await retained.verify();report.sessionReleased=true;report.browserRetained=true;}catch(error){report.cleanupError=error.message;report.sessionReleased=false;}
    }else if(child) {
      try{await io.stopOwnBrowser(child);report.ownBrowserStopped=exited(child);if(child.fishCleanup)report.browserCloseMethod=child.fishCleanup;}
      catch(error){report.cleanupError=error.message;}
      try{report.portReleased=(await io.listListeners()).length===0;}
      catch(error){report.cleanupError=error.message;}
      if(!report.ownBrowserStopped||!report.portReleased)
        report.manualAction='Close only the dedicated test window and verify port 9222 is no longer listening. Do not stop personal browser processes.';
    }
  }
  const lifecycle=retained?report.sessionReleased===true&&report.browserRetained===true:report.ownBrowserStopped&&report.portReleased;
  report.success=!report.error&&report.pageRead&&report.videoRead&&report.bindingVerified&&lifecycle&&(options.includeComments!==true||report.commentsRead===true);
  report.finishedAt=new Date().toISOString();
  return report;
}

async function writeJson(handle,value) {
  const buffer=Buffer.from(JSON.stringify(value,null,2)+'\n','utf8');
  let offset=0;
  while(offset<buffer.length) {
    const {bytesWritten}=await handle.write(buffer,offset,buffer.length-offset,offset);
    if(!bytesWritten)throw new Error('Report write made no progress');
    offset+=bytesWritten;
  }
  await handle.truncate(buffer.length);await handle.sync();
}

export async function executeWithReport(options,dependencies={}) {
  const run=dependencies.run??runSmoke;
  if(options.approved!==true)return run(options);
  const directory=dependencies.directory??join(here,'results');
  const fs=dependencies.fs??{mkdir,open};
  // Verify directory/file write access before profile creation, network or launch.
  await fs.mkdir(directory,{recursive:true});
  const path=join(directory,'browser-test-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.json');
  const handle=await fs.open(path,'wx');
  try {
    await writeJson(handle,{diagnosticVersion:'jingxuan-0.2.0',status:'reserved_not_started',success:false,
      scope:'single_jingxuan_page',note:'An incomplete placeholder does not prove a browser test ran.'});
    const result=await run(options);
    await writeJson(handle,result);
    return {...result,reportPath:path};
  }finally{await handle.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const options=parseArguments(process.argv.slice(2));
    const result=await executeWithReport(options);
    console.log(JSON.stringify(result,null,2));
    if(options.approved&&!result.success)process.exitCode=1;
  } catch(error){console.error(error.message);process.exitCode=1;}
}

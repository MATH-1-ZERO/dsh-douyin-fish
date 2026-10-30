import {SNAPSHOT_EXPRESSION,OPEN_PUBLIC_CARD_EXPRESSION} from './snapshot-expression.mjs';
import {approvedVideoPage} from './route-policy.mjs';
import {commentSnapshotExpression} from './comment-snapshot.mjs';
import {validateCommentSnapshot,videoIdFromPage} from '../comment-policy.js';
import {OPEN_COMMENT_PANEL_EXPRESSION} from './open-comment-panel.mjs';
import {replyComposerExpression} from './open-reply-composer.mjs';
import {interactionExpression} from './interaction-expression.mjs';
import {WATCH_EXPRESSION,BOUND_FRAME_CLIP_EXPRESSION,validateWatchSample} from './watch-expression.mjs';
// Standalone bounded reader, with one explicitly armed public-video navigation. No sending.
import { homedir, userInfo } from 'node:os';
import { resolve, join, isAbsolute } from 'node:path';

function canonicalTestUrl(value,c) {
  if(typeof value!=='string')return null;
  try {
    const url=new URL(value);
    if(url.username||url.password)return null;
    return approvedVideoPage(url.href);
  }catch{return null;}
}

function pageState(value,c) {
  if(canonicalTestUrl(value,c))return 'allowed_test_page';
  if(value==='about:blank')return 'initial_blank_page';
  if(value==='')return 'initial_empty_page';
  if(typeof value!=='string'||!value)return 'missing_url';
  if(/^(?:chrome-error|edge-error):/i.test(value))return 'browser_error_page';
  if(/^(?:edge|chrome):/i.test(value))return 'browser_internal_page';
  return 'outside_test_page';
}

function routeDiagnostic(value) {
  try {const u=new URL(value);return u.origin==='https://www.douyin.com'&&!u.username&&!u.password?
    {sameSite:true,path:u.pathname.slice(0,120),hasQuery:!!u.search,hasFragment:!!u.hash}:{sameSite:false};}
  catch{return {sameSite:false};}
}

export function browserSettings(settings) {
  const c = { enabled:false, endpoint:'http://127.0.0.1:9222',
    allowedPages:['https://www.douyin.com/jingxuan'], ...settings.browser };
  const endpoint = new URL(c.endpoint);
  if (typeof c.enabled !== 'boolean' || endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      !endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password)
    throw new Error('Browser endpoint must be an explicit 127.0.0.1 HTTP port');
  // Standalone public-page diagnostic only; not installed in DSH.
  if (!Array.isArray(c.allowedPages) || c.allowedPages.length !== 1 || c.allowedPages[0] !== 'https://www.douyin.com/jingxuan')
    throw new Error('This build only permits https://www.douyin.com/jingxuan');
  return c;
}

export class CdpConnection {
  armForegroundOnce(sessionId){if(typeof sessionId!=='string'||!sessionId)throw Error('Invalid foreground permit');this.foregroundPermit={sessionId};}
  armWheelOnce(point,sessionId){if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||typeof sessionId!=='string'||!sessionId)throw Error('Invalid wheel permit');this.wheelPermit={...point,sessionId};}
  armSelectAllOnce(sessionId){if(typeof sessionId!=='string'||!sessionId)throw Error('Invalid select-all permit');this.selectAllPermit={sessionId,next:'keyDown'};}
  armHoverOnce(point,sessionId){
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>10000||point.y>10000||typeof sessionId!=='string'||!sessionId)throw Error('Invalid hover permit');
    this.hoverPermit={...point,sessionId};
  }
  armDeleteSelectionOnce(sessionId){
    if(typeof sessionId!=='string'||!sessionId)throw Error('Invalid delete permit');
    this.deletePermit={sessionId,next:'keyDown'};
  }
  armBrowserCloseOnce(){this.browserClosePermit=true;}
  armPointerOnce(point,sessionId){
    if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>10000||point.y>10000||typeof sessionId!=='string'||!sessionId)throw Error('Invalid pointer permit');
    this.pointerPermit={...point,sessionId,next:'mousePressed'};
  }
  armTextInputOnce(text,sessionId){
    if(typeof text!=='string'||[...text].length>300||typeof sessionId!=='string'||!sessionId)throw Error('Invalid text input permit');
    this.textPermit={text,sessionId};
  }
  constructor(socket,signal,timeoutMs=5000) {
    this.socket=socket;this.nextId=0;this.pending=new Map();this.timeoutMs=timeoutMs;
    this.fail=error=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();};
    this.abort=()=>{this.fail(new Error('Browser read cancelled'));socket.close();};
    this.signal=signal;
    socket.addEventListener('message',event=>{
      try {
        if(typeof event.data!=='string'||Buffer.byteLength(event.data,'utf8')>262144)throw new Error('Invalid CDP message');
        const message=JSON.parse(event.data), p=this.pending.get(message.id);
        if(!p)return;
        this.pending.delete(message.id);clearTimeout(p.timer);
        if(message.error)p.reject(new Error('Browser protocol refused read'));
        else p.resolve(message.result);
      }catch(error){this.fail(error);socket.close();}
    });
    socket.addEventListener('close',()=>this.fail(new Error('Browser connection closed')));
    socket.addEventListener('error',()=>this.fail(new Error('Browser connection failed')));
    signal?.addEventListener('abort',this.abort,{once:true});
    if(signal?.aborted)this.abort();
  }
  send(method,params={},sessionId) {
    if(this.signal?.aborted)return Promise.reject(new Error('Browser read cancelled'));
    const allowed=['Browser.getBrowserCommandLine','Target.getTargets','Target.attachToTarget',
      'Page.getFrameTree','Page.createIsolatedWorld','Runtime.evaluate'];
    if(method==='Page.bringToFront'){
      const permit=this.foregroundPermit;this.foregroundPermit=null;
      if(!permit||permit.sessionId!==sessionId||Object.keys(params).length)return Promise.reject(new Error('Foreground not allowed without exact one-time permit'));
    }else if(method==='Browser.close'){
      const permitted=this.browserClosePermit;this.browserClosePermit=false;
      if(!permitted||sessionId!==undefined||Object.keys(params).length)return Promise.reject(new Error('Browser close not allowed without one-time permit'));
    }else if(method==='Input.insertText'){
      const permit=this.textPermit;this.textPermit=null;
      if(!permit||permit.text!==params.text||permit.sessionId!==sessionId||Object.keys(params).length!==1)return Promise.reject(new Error('Text input not allowed without exact one-time permit'));
    }else if(method==='Input.dispatchKeyEvent'){
      if(params.key==='a'&&params.modifiers===2){
        const p=this.selectAllPermit;
        if(!p||p.sessionId!==sessionId||params.type!==p.next||params.code!=='KeyA'||params.windowsVirtualKeyCode!==65||params.nativeVirtualKeyCode!==65||Object.keys(params).length!==6){this.selectAllPermit=null;return Promise.reject(new Error('Select-all key not allowed without exact one-time permit'));}
        if(p.next==='keyDown')p.next='keyUp';else this.selectAllPermit=null;
      }else{
      const permit=this.deletePermit;
      if(!permit||permit.sessionId!==sessionId||params.type!==permit.next||params.key!=='Backspace'||params.code!=='Backspace'||params.windowsVirtualKeyCode!==8||params.nativeVirtualKeyCode!==8||Object.keys(params).length!==5){this.deletePermit=null;return Promise.reject(new Error('Delete key not allowed without exact one-time permit'));}
      if(permit.next==='keyDown')permit.next='keyUp';else this.deletePermit=null;
      }
    }else if(method==='Input.dispatchMouseEvent'){
      if(params.type==='mouseWheel'){
        const p=this.wheelPermit;this.wheelPermit=null;if(!p||p.sessionId!==sessionId||p.x!==params.x||p.y!==params.y||params.deltaX!==0||params.deltaY!==700||Object.keys(params).length!==5)return Promise.reject(new Error('Wheel not allowed without exact one-time permit'));
      }else if(params.type==='mouseMoved'){
        const hover=this.hoverPermit;this.hoverPermit=null;
        if(!hover||hover.sessionId!==sessionId||hover.x!==params.x||hover.y!==params.y||Object.keys(params).length!==3)return Promise.reject(new Error('Hover not allowed without exact one-time permit'));
      }else{
      const permit=this.pointerPermit;
      if(!permit||permit.sessionId!==sessionId||params.type!==permit.next||params.x!==permit.x||params.y!==permit.y||params.button!=='left'||params.clickCount!==1||Object.keys(params).length!==5){this.pointerPermit=null;return Promise.reject(new Error('Pointer not allowed without exact one-time permit'));}
      if(permit.next==='mousePressed')permit.next='mouseReleased';else this.pointerPermit=null;
      }
    }else if(method!=='Page.captureScreenshot'&&!allowed.includes(method))return Promise.reject(new Error('CDP method not allowed'));
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Browser read timed out'));this.close();},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));}
      catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  close(){this.signal?.removeEventListener('abort',this.abort);this.fail(new Error('Browser connection closed'));this.socket.close();}
}

export async function connect(c,signal) {
  const controller=new AbortController();
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)controller.abort();
  const timer=setTimeout(abort,5000);
  try {
    const response=await fetch(new URL('/json/version',c.endpoint),{redirect:'error',signal:controller.signal});
    if(!response.ok||!response.body)throw new Error('Browser discovery failed');
    const reader=response.body.getReader();let total=0;const chunks=[];
    try {for(;;){const {done,value}=await reader.read();if(done)break;
      total+=value.length;if(total>16384)throw new Error('Browser discovery too large');chunks.push(Buffer.from(value));}}
    finally {await reader.cancel().catch(()=>{});}
    const info=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const socketUrl=new URL(info.webSocketDebuggerUrl), endpoint=new URL(c.endpoint);
    if(socketUrl.protocol!=='ws:'||socketUrl.hostname!=='127.0.0.1'||socketUrl.port!==endpoint.port||
        !/^\/devtools\/browser\/[a-zA-Z0-9_-]+$/.test(socketUrl.pathname)||socketUrl.username||socketUrl.password||socketUrl.search||socketUrl.hash)
      throw new Error('Browser returned an unsafe debugger endpoint');
    if(controller.signal.aborted)throw new Error('Browser discovery cancelled');
    const socket=new WebSocket(socketUrl);
    await new Promise((resolve,reject)=>{
      const abortSocket=()=>{cleanup();socket.close();reject(new Error('Browser connection cancelled'));};
      const open=()=>{cleanup();resolve();};
      const error=()=>{cleanup();socket.close();reject(new Error('Browser connection failed'));};
      const cleanup=()=>{socket.removeEventListener('open',open);socket.removeEventListener('error',error);
        controller.signal.removeEventListener('abort',abortSocket);};
      socket.addEventListener('open',open,{once:true});socket.addEventListener('error',error,{once:true});
      controller.signal.addEventListener('abort',abortSocket,{once:true});
      if(controller.signal.aborted)abortSocket();
    });
    const connection=new CdpConnection(socket,signal);connection.browserId=socketUrl.pathname.split('/').at(-1);return connection;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

function profileArgument(args,key) {
  const found=args.filter(a=>a===key||a.startsWith(key+'='));
  return found.length===1&&found[0].startsWith(key+'=')?found[0].slice(key.length+1):undefined;
}

export async function readTestPage(settings,{signal,targetId,openPublicCard=false,includeComments=false,openCommentPanel=false,probeReplyComposer=false,probeReplyKey,operation,screenshot=false,expectedVideoId,watch=false,frame=false}={},dependencies={}) {
  const c=browserSettings(settings);
  if(!c.enabled)return {allowed:false,reason:'browser_disabled'};
  if(signal?.aborted)throw new Error('Browser read cancelled');
  if(targetId!==undefined&&(typeof targetId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(targetId)))throw new Error('Invalid target id');
  const identity=dependencies.identity??(()=>({username:userInfo().username,home:homedir()}));
  const user=identity();
  if(typeof user.username!=='string'||!user.username.trim()||typeof user.home!=='string'||!isAbsolute(user.home))
    return {allowed:false,reason:'invalid_local_identity'};
  const session=await (dependencies.connect??connect)(c,signal);
  try {
    const command=await session.send('Browser.getBrowserCommandLine');
    const args=command?.arguments;
    const expected=resolve(join(user.home,'.dsh','douyin-fish-public-test')).toLowerCase();
    if(!Array.isArray(args)||!args.every(x=>typeof x==='string')||
        !args.includes('--enable-automation')||
        profileArgument(args,'--remote-debugging-address')!=='127.0.0.1'||
        profileArgument(args,'--remote-debugging-port')!==new URL(c.endpoint).port||
        !profileArgument(args,'--user-data-dir')||
        resolve(profileArgument(args,'--user-data-dir')).toLowerCase()!==expected)
      return {allowed:false,reason:'dedicated_browser_profile_required'};
    const listing=await session.send('Target.getTargets');
    if(!Array.isArray(listing?.targetInfos)||listing.targetInfos.length>500)throw new Error('Invalid browser targets');
    const pages=listing.targetInfos.filter(t=>t.type==='page'&&canonicalTestUrl(t.url,c)&&(!targetId||t.targetId===targetId));
    if(pages.length!==1)return {allowed:false,reason:pages.length?'ambiguous_test_pages':'no_allowed_test_page',
      diagnostic:{stage:'target_selection',allowedTargetCount:pages.length,
        pageStates:listing.targetInfos.filter(t=>t.type==='page').slice(0,10).map(t=>({state:pageState(t.url,c),route:routeDiagnostic(t.url)}))}};
    const target=pages[0];
    const attached=await session.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    if(typeof attached?.sessionId!=='string'||!attached.sessionId)throw new Error('Invalid browser session');
    const frame=await session.send('Page.getFrameTree',{},attached.sessionId);
    const rootFrame=frame?.frameTree?.frame;
    if(!canonicalTestUrl(rootFrame?.url,c)) {
      const classification=pageState(rootFrame?.url,c);
      const initializing=['initial_blank_page','initial_empty_page'].includes(classification)&&typeof rootFrame?.id==='string'&&!!rootFrame.id;
      return {allowed:false,reason:initializing?'page_not_ready':'page_changed',
        diagnostic:{stage:'main_frame_check',targetState:pageState(target.url,c),frameState:classification,route:routeDiagnostic(rootFrame?.url),
          responseKeys:frame&&typeof frame==='object'?Object.keys(frame).slice(0,10):[],
          frameTreeKeys:frame?.frameTree&&typeof frame.frameTree==='object'?Object.keys(frame.frameTree).slice(0,10):[],
          frameKeys:rootFrame&&typeof rootFrame==='object'?Object.keys(rootFrame).slice(0,20):[],
          urlType:typeof rootFrame?.url,
          unreachableTestPage:!!canonicalTestUrl(rootFrame?.unreachableUrl,c)}};
    }
    const world=await session.send('Page.createIsolatedWorld',{
      frameId:frame.frameTree.frame.id,worldName:'douyin-fish-read-only',
    },attached.sessionId);
    if(!Number.isInteger(world?.executionContextId))throw new Error('Invalid isolated context');
    if(watch===true){
      if(signal?.aborted)throw new Error('Browser read cancelled');
      const sampled=await session.send('Runtime.evaluate',{
        contextId:world.executionContextId,expression:WATCH_EXPRESSION,
        returnByValue:true,awaitPromise:true,timeout:1000,userGesture:false,
      },attached.sessionId);
      if(sampled?.exceptionDetails)throw new Error('Watch sample refused');
      const state=validateWatchSample(sampled?.result?.value);
      if(!state.bound)return {allowed:false,reason:'watch_'+state.reason,...(state.restriction?{restriction:state.restriction}:{})};
      let frameData;
      if(frame===true){
        const geometry=await session.send('Runtime.evaluate',{contextId:world.executionContextId,expression:BOUND_FRAME_CLIP_EXPRESSION,returnByValue:true,timeout:1000},attached.sessionId);
        const clip=geometry?.result?.value;
        if(geometry?.exceptionDetails||!clip?.ready)throw new Error('Bound frame geometry refused');
        const captured=await session.send('Page.captureScreenshot',{format:'jpeg',quality:40,captureBeyondViewport:false,fromSurface:true,clip:clip.clip},attached.sessionId);
        if(typeof captured?.data!=='string'||captured.data.length>240000)throw new Error('Frame capture invalid or oversized');
        frameData={bytes:Buffer.byteLength(captured.data,'utf8'),clip:clip.clip};
      }
      return {allowed:true,source:'live_watch_sample',watchState:state.sample,...(frameData?{frame:frameData}:{}),sendingSupported:false};
    }
    const extracted=await session.send('Runtime.evaluate',{
      contextId:world.executionContextId,
      expression:includeComments?commentSnapshotExpression(SNAPSHOT_EXPRESSION):SNAPSHOT_EXPRESSION,
      returnByValue:true,awaitPromise:true,timeout:1000,userGesture:false,
    },attached.sessionId);
    const value=extracted?.result?.value;
    if(expectedVideoId&&typeof expectedVideoId==='string'&&/^\d{10,25}$/.test(expectedVideoId)&&!extracted?.exceptionDetails&&canonicalTestUrl(value?.url,c)&&value.url!==target.url&&videoIdFromPage(value.url)===expectedVideoId)return {allowed:false,reason:'expected_video_navigation_pending'};
    if(extracted?.exceptionDetails||!value||!canonicalTestUrl(value.url,c)||canonicalTestUrl(value.url,c)!==canonicalTestUrl(target.url,c))
      return {allowed:false,reason:'page_changed_or_unreadable',diagnostic:{stage:'snapshot_check',
        snapshotState:pageState(value?.url,c),executionException:!!extracted?.exceptionDetails}};
    if(typeof value.title!=='string'||typeof value.text!=='string'||value.text.length>1200)throw new Error('Invalid page snapshot');
    if(!['loading','interactive','complete'].includes(value.readyState))throw new Error('Invalid document readiness');
    if(value.readyState==='loading'||!value.title.trim())return {allowed:false,reason:'page_not_ready',
      diagnostic:{stage:'document_readiness',documentState:value.readyState}};
    if(typeof value.pageDescription!=='string'||value.pageDescription.length>500||!Number.isInteger(value.captionCandidateCount)||value.captionCandidateCount<0||!['','login','verification'].includes(value.restriction))throw new Error('Invalid metadata');
    if(openPublicCard===true&&value.url==='https://www.douyin.com/jingxuan'&&value.restriction===''&&value.visibleVideoCount===0){
      const opened=await session.send('Runtime.evaluate',{contextId:world.executionContextId,expression:OPEN_PUBLIC_CARD_EXPRESSION,returnByValue:true,timeout:1000,userGesture:true},attached.sessionId);
      if(opened?.exceptionDetails)throw new Error('Public video navigation failed; no retry');
      if(opened?.result?.value?.clicked===true)return {allowed:false,reason:'public_video_opened',navigationClickPerformed:true};
    }
    if(!Number.isInteger(value.visibleVideoCount)||value.visibleVideoCount<0||typeof value.captionBound!=='boolean'||typeof value.videoKey!=='string'||(value.videoKey!==''&&!/^[a-f0-9]{64}$/.test(value.videoKey)))throw new Error('Invalid video binding');
    if(value.structure!==undefined&&(typeof value.structure!=='object'||JSON.stringify(value.structure).length>16000))throw new Error('Invalid structure diagnostic');
    if(signal?.aborted)throw new Error('Browser read cancelled');
    if(includeComments&&openCommentPanel&&value.restriction===''&&value.captionBound===true&&value.commentSnapshot?.status==='unsupported_structure'){
      const opened=await session.send('Runtime.evaluate',{contextId:world.executionContextId,expression:OPEN_COMMENT_PANEL_EXPRESSION,returnByValue:true,timeout:1000,userGesture:true},attached.sessionId);
      if(opened?.exceptionDetails)throw Error('Comment panel open failed; no retry');
      if(opened?.result?.value?.clicked===true)return {allowed:false,reason:'comment_panel_opened',commentPanelClickPerformed:true};
    }
    let commentSnapshot;
    if(includeComments){
      if(['bound_visible_comments','bound_visible_cards'].includes(value.commentSnapshot?.status))commentSnapshot={...validateCommentSnapshot(value.commentSnapshot,value.url),...(value.commentSnapshot.diagnostic&&JSON.stringify(value.commentSnapshot.diagnostic).length<=20000?{diagnostic:value.commentSnapshot.diagnostic}:{})};
      else commentSnapshot={status:'unsupported_structure',comments:[],...(value.commentSnapshot?.diagnostic&&JSON.stringify(value.commentSnapshot.diagnostic).length<=20000?{diagnostic:value.commentSnapshot.diagnostic}:{})};
    }
    if(probeReplyComposer&&commentSnapshot?.status==='bound_visible_cards'){
      const selected=commentSnapshot.comments.find(c=>(probeReplyKey===undefined||c.localCommentKey===probeReplyKey)&&!/去死|滚蛋|傻[逼比]|加我微信|转账|验证码|密码|cookie|access[_ -]?token/iu.test(c.text));
      if(selected){
        const opened=await session.send('Runtime.evaluate',{contextId:world.executionContextId,expression:replyComposerExpression(commentSnapshot.videoId,selected.localCommentKey),returnByValue:true,awaitPromise:true,timeout:1000,userGesture:true},attached.sessionId);
        if(opened?.exceptionDetails)throw Error('Reply composer diagnostic failed; no retry');
        if(opened?.result?.value?.clicked===true)return {allowed:false,reason:'reply_composer_opened',replyComposerClickPerformed:true};
      }
    }
    let operationResult;
    if(operation){
      const evaluate=async phase=>session.send('Runtime.evaluate',{contextId:world.executionContextId,expression:interactionExpression({...operation,phase}),returnByValue:true,awaitPromise:true,timeout:1000,userGesture:phase!=='inspect'},attached.sessionId);
      let operated;
      if(['click_like','click_focus','click_submit','click_reply','click_share_open','click_mention_open','click_mention_candidate','click_native_share_send','click_native_mention_submit'].includes(operation.phase)){
        const guard=await evaluate({click_like:'point_like',click_focus:'point_focus',click_submit:'point_submit',click_reply:'point_reply',click_share_open:'point_share_open',click_mention_open:'point_mention_open',click_mention_candidate:'point_mention_candidate',click_native_share_send:'point_native_share_send',click_native_mention_submit:'point_native_mention_submit'}[operation.phase]);
        const point=guard?.result?.value?.point;
        if(guard?.exceptionDetails||guard?.result?.value?.ready!==true||!point){const error=Error(guard?.result?.value?.reason||'Pointer guard refused');error.actionNotApplied=true;throw error;}
        session.armPointerOnce(point,attached.sessionId);
        for(const type of ['mousePressed','mouseReleased'])await session.send('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,button:'left',clickCount:1},attached.sessionId);
        operated={result:{value:{ready:true,clicked:true}}};
      }else if(operation.phase==='advance_one_video'){
        const guard=await evaluate('point_next_video'),p=guard?.result?.value;
        if(guard.exceptionDetails||!p?.ready||!p.point){const e=Error(p?.reason||'Video scroll refused');e.actionNotApplied=true;throw e;}
        // Establish the pointer target without clicking a player or composer.
        session.armHoverOnce(p.point,attached.sessionId);
        await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p.point},attached.sessionId);
        const rechecked=await evaluate('point_next_video'),q=rechecked?.result?.value;
        if(rechecked.exceptionDetails||!q?.ready||!q.point||q.point.x!==p.point.x||q.point.y!==p.point.y){const e=Error(q?.reason||'Video scroll target moved');e.actionNotApplied=true;throw e;}
        session.armWheelOnce(p.point,attached.sessionId);await session.send('Input.dispatchMouseEvent',{type:'mouseWheel',...p.point,deltaX:0,deltaY:700},attached.sessionId);operated={result:{value:{ready:true,scrollAttempted:true}}};
      }else if(operation.phase==='append_owner_mention_query'){
        const guard=await evaluate('mention_query_append_guard');
        if(guard.exceptionDetails||!guard.result?.value?.ready)throw Error(guard.result?.value?.reason||'Native mention query refused');
        session.armTextInputOnce(operation.ownerName,attached.sessionId);await session.send('Input.insertText',{text:operation.ownerName},attached.sessionId);
        operated={result:{value:{ready:true,appended:true}}};
       }else if(operation.phase==='append_native_mention_body'){
        const guard=await evaluate('native_mention_append_guard');if(guard.exceptionDetails||!guard.result?.value?.ready)throw Error(guard.result?.value?.reason||'Native mention append refused');
        const text=' '+operation.mentionText;session.armTextInputOnce(text,attached.sessionId);await session.send('Input.insertText',{text},attached.sessionId);await new Promise(resolve=>setTimeout(resolve,150));operated=await evaluate('native_mention_state');
      }else if(operation.phase==='clear_native_mention'){
        const guard=await evaluate('native_mention_clear_guard');if(guard.exceptionDetails||!guard.result?.value?.ready)throw Error(guard.result?.value?.reason||'Native mention clear refused');
        session.armSelectAllOnce(attached.sessionId);for(const type of ['keyDown','keyUp'])await session.send('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65},attached.sessionId);
        await new Promise(resolve=>setTimeout(resolve,100));
        session.armDeleteSelectionOnce(attached.sessionId);for(const type of ['keyDown','keyUp'])await session.send('Input.dispatchKeyEvent',{type,key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8},attached.sessionId);
        await new Promise(resolve=>setTimeout(resolve,150));operated=await evaluate('native_mention_verify_clear');
      }else if(['hover_share_owner','hover_share_open'].includes(operation.phase)){

        const guard=await evaluate(operation.phase==='hover_share_open'?'point_share_open':'point_share_owner_hover'),value=guard?.result?.value;
        if(guard?.exceptionDetails||!value?.ready||!value.point)throw Error(value?.reason||'Owner hover refused');
        session.armHoverOnce(value.point,attached.sessionId);await session.send('Input.dispatchMouseEvent',{type:'mouseMoved',...value.point},attached.sessionId);
        operated={result:{value:{ready:true,hovered:true,recipientSelected:false}}};
      }else if(['fill','clear'].includes(operation.phase)){
        const guard=await evaluate(operation.phase==='fill'?'input_guard':'clear_guard');
        if(guard?.exceptionDetails||guard?.result?.value?.ready!==true)throw Error(guard?.result?.value?.reason||'Input guard refused');
        if(operation.phase==='fill'){
          const text=operation.text;session.armTextInputOnce(text,attached.sessionId);await session.send('Input.insertText',{text},attached.sessionId);
        }else{
          // insertText('') does not reliably delete rich-text selections.
          // The fixed guard above selected only our unchanged exact draft.
          session.armDeleteSelectionOnce(attached.sessionId);
          for(const type of ['keyDown','keyUp'])await session.send('Input.dispatchKeyEvent',{type,key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8},attached.sessionId);
          await new Promise(resolve=>setTimeout(resolve,150));
        }
        operated=await evaluate(operation.phase==='fill'?'verify_input':'verify_clear');
      }else operated=await evaluate(operation.phase);
      if(operated?.exceptionDetails)throw Error('Bound browser operation failed');
      operationResult=operated?.result?.value;
    }
    let screenshotData;
    if(screenshot){
      let clip;
      if(screenshot==='public_composer'){
        const r=await session.send('Runtime.evaluate',{contextId:world.executionContextId,expression:interactionExpression({phase:'composer_geometry',videoId:videoIdFromPage(value.url)}),returnByValue:true,timeout:1000},attached.sessionId);
        if(r.exceptionDetails||!r.result?.value?.ready)throw Error('Empty public composer screenshot refused');clip=r.result.value.clip;
      }
      const captured=await session.send('Page.captureScreenshot',{format:'jpeg',quality:50,captureBeyondViewport:false,fromSurface:true,...(clip?{clip}:{})},attached.sessionId);if(typeof captured?.data!=='string'||captured.data.length>240000)throw Error('Screenshot invalid or oversized');screenshotData=captured.data;
    }
    return {allowed:true,source:'live_test_page',...(screenshot?{screenshotData}:{}),...(operation?{operationResult}:{}),untrustedPage:{url:canonicalTestUrl(value.url,c),title:value.title.slice(0,200),text:value.text,pageDescription:value.pageDescription,captionCandidateCount:value.captionCandidateCount,restriction:value.restriction,visibleVideoCount:value.visibleVideoCount,captionBound:value.captionBound,videoKey:value.videoKey,structure:value.structure},
      ...(includeComments?{commentSnapshot}:{}),sendingSupported:false};
  } finally {session.close();}
}

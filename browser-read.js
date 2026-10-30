// Staged read-only connector. No process launch, clicks, navigation or sending.
import { homedir, userInfo } from 'node:os';
import { resolve, join, isAbsolute } from 'node:path';

function canonicalTestUrl(value,c) {
  if(typeof value!=='string')return null;
  try {
    const url=new URL(value);
    if(url.username||url.password)return null;
    return c.allowedPages.includes(url.href)?url.href:null;
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

export function browserSettings(settings) {
  const c = { enabled:false, endpoint:'http://127.0.0.1:9222',
    allowedPages:['https://example.com/'], ...settings.browser };
  const endpoint = new URL(c.endpoint);
  if (typeof c.enabled !== 'boolean' || endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      !endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password)
    throw new Error('Browser endpoint must be an explicit 127.0.0.1 HTTP port');
  // This release intentionally admits only the public test page.
  if (!Array.isArray(c.allowedPages) || c.allowedPages.length !== 1 || c.allowedPages[0] !== 'https://example.com/')
    throw new Error('This build only permits https://example.com/');
  return c;
}

export class CdpConnection {
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
    if(!allowed.includes(method))return Promise.reject(new Error('CDP method not allowed'));
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

async function connect(c,signal) {
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
    return new CdpConnection(socket,signal);
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

function profileArgument(args,key) {
  const found=args.filter(a=>a===key||a.startsWith(key+'='));
  return found.length===1&&found[0].startsWith(key+'=')?found[0].slice(key.length+1):undefined;
}

export async function readTestPage(settings,{signal,targetId}={},dependencies={}) {
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
    const expected=resolve(join(user.home,'.dsh','douyin-fish-browser')).toLowerCase();
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
        pageStates:listing.targetInfos.filter(t=>t.type==='page').slice(0,10).map(t=>pageState(t.url,c))}};
    const target=pages[0];
    const attached=await session.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    if(typeof attached?.sessionId!=='string'||!attached.sessionId)throw new Error('Invalid browser session');
    const frame=await session.send('Page.getFrameTree',{},attached.sessionId);
    const rootFrame=frame?.frameTree?.frame;
    if(!canonicalTestUrl(rootFrame?.url,c)) {
      const classification=pageState(rootFrame?.url,c);
      const initializing=['initial_blank_page','initial_empty_page'].includes(classification)&&typeof rootFrame?.id==='string'&&!!rootFrame.id;
      return {allowed:false,reason:initializing?'page_not_ready':'page_changed',
        diagnostic:{stage:'main_frame_check',targetState:pageState(target.url,c),frameState:classification,
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
    const extracted=await session.send('Runtime.evaluate',{
      contextId:world.executionContextId,
      expression:'(()=>({url:location.href,readyState:document.readyState,title:document.title,text:(document.body?.innerText||" ").slice(0,1200)}))()',
      returnByValue:true,timeout:1000,userGesture:false,
    },attached.sessionId);
    const value=extracted?.result?.value;
    if(extracted?.exceptionDetails||!value||!canonicalTestUrl(value.url,c)||canonicalTestUrl(value.url,c)!==canonicalTestUrl(target.url,c))
      return {allowed:false,reason:'page_changed_or_unreadable',diagnostic:{stage:'snapshot_check',
        snapshotState:pageState(value?.url,c),executionException:!!extracted?.exceptionDetails}};
    if(typeof value.title!=='string'||typeof value.text!=='string'||value.text.length>1200)throw new Error('Invalid page snapshot');
    if(!['loading','interactive','complete'].includes(value.readyState))throw new Error('Invalid document readiness');
    if(value.readyState==='loading'||!value.title.trim()||!value.text.trim())return {allowed:false,reason:'page_not_ready',
      diagnostic:{stage:'document_readiness',documentState:value.readyState}};
    if(signal?.aborted)throw new Error('Browser read cancelled');
    return {allowed:true,source:'live_test_page',untrustedPage:{url:canonicalTestUrl(value.url,c),title:value.title.slice(0,200),text:value.text},
      sendingSupported:false};
  } finally {session.close();}
}

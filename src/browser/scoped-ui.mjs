import {homedir} from 'node:os';import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {plan,listListeners,chooseBrowser,prepareProfile,launchBrowser,stopOwnBrowser} from './browser-smoke.mjs';
import {connect} from './browser-read.js';
export function profilePage(value){
 try{const u=new URL(value);return u.origin==='https://www.douyin.com'&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/user\/[A-Za-z0-9_-]{5,200}$/.test(u.pathname)?u.href:null;}catch{return null;}
}
export async function withUiPage(target,callback,{signal,connection=connect,home=homedir()}={}){
 if(!profilePage(target))throw Error('Exact public profile required');
 const session=await connection({endpoint:'http://127.0.0.1:9222'},signal);
 try{
  const command=await session.send('Browser.getBrowserCommandLine'),args=command?.arguments;
  const one=key=>{const a=args?.filter(x=>x.startsWith(key+'='));return a?.length===1?a[0].slice(key.length+1):null;};
  if(!Array.isArray(args)||!args.every(x=>typeof x==='string')||!args.includes('--enable-automation')||one('--remote-debugging-address')!=='127.0.0.1'||one('--remote-debugging-port')!=='9222'||resolve(one('--user-data-dir')||'.').toLowerCase()!==resolve(join(home,'.dsh','douyin-fish-public-test')).toLowerCase())throw Error('Dedicated profile identity refused');
  const targets=await session.send('Target.getTargets');
  const pages=targets?.targetInfos?.filter(p=>p.type==='page'&&p.url===target);
  if(pages?.length!==1)throw Error('Profile page not ready or ambiguous');
  const attached=await session.send('Target.attachToTarget',{targetId:pages[0].targetId,flatten:true}),sessionId=attached?.sessionId;
  if(typeof sessionId!=='string'||!sessionId)throw Error('Invalid UI session');
  const frame=await session.send('Page.getFrameTree',{},sessionId);
  if(frame?.frameTree?.frame?.url!==target)throw Error('Profile main frame changed');
  const world=await session.send('Page.createIsolatedWorld',{frameId:frame.frameTree.frame.id,worldName:'fish-scoped-ui'},sessionId);
  if(!Number.isInteger(world.executionContextId))throw Error('Invalid UI world');
  return await callback({session,sessionId,contextId:world.executionContextId,targetId:pages[0].targetId,frameId:frame.frameTree.frame.id,loaderId:frame.frameTree.frame.loaderId});
 }finally{session.close();}
}
export async function runProfileSession(target,callback,{signal,io={},reloadIfSame=true}={}){
 if(!profilePage(target))throw Error('Exact public profile required');
 if(typeof reloadIfSame!=='boolean')throw Error('Invalid profile reload option');
 const deps={listListeners,chooseBrowser,prepareProfile,launchBrowser,stopOwnBrowser,delay,...io},description=plan(),report={scope:'one_exact_public_profile',target,success:false,ownBrowserStopped:false,portReleased:false,interactionSent:false};let child;
 const retained=io.reuseLease;
 try{
  if(retained){await retained.verify();await retained.navigate(target,{reloadIfSame});report.browserReused=true;report.bindingVerified=true;report.reloadIfSame=reloadIfSame;}else{
  if((await deps.listListeners()).length)throw Error('PORT_IN_USE: do not attach');
  if(signal?.aborted)throw Error('Cancelled');
  await deps.prepareProfile(description.profile);
  child=await deps.launchBrowser(await deps.chooseBrowser(),['--user-data-dir='+description.profile,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--enable-automation','--no-first-run','--disable-sync','--new-window',target]);
  let bound=false;
  for(let i=0;i<40;i++){
   if(signal?.aborted)throw Error('Cancelled');
   const bindings=await deps.listListeners();
   if(bindings.length){if(bindings.length!==1||bindings[0].pid!==child.pid||bindings[0].address!=='127.0.0.1')throw Error('Unexpected browser binding');bound=true;break;}
   await deps.delay(250,undefined,{signal});
  }
  if(!bound)throw Error('Browser binding timeout');
  }
  report.bindingVerified=true;report.result=await callback({target,signal});report.success=true;
 }catch(e){report.error=e.message;}
 finally{
  if(retained){try{await retained.verify();report.sessionReleased=true;report.browserRetained=true;}catch(e){report.cleanupError=e.message;report.sessionReleased=false;}}
  else if(child){try{await deps.stopOwnBrowser(child);report.ownBrowserStopped=child.exitCode!==null||child.signalCode!=null;report.cleanupMethod=child.fishCleanup??'not_reported';}catch(e){report.cleanupError=e.message;}
  try{report.portReleased=(await deps.listListeners()).length===0;}catch(e){report.cleanupError=e.message;}}
 }
 report.success=report.success&&(retained?report.sessionReleased===true&&report.browserRetained===true:report.ownBrowserStopped&&report.portReleased);return report;
}
function captureProfile(expected){
 if(location.href!==expected)return {ready:false,reason:'profile_changed'};
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>0;};
 const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible).map(e=>(e.innerText||'').slice(0,500)).join(' ');
 if(/验证码|安全验证|captcha|滑块/.test(dialogs))return {ready:false,reason:'verification_required'};
 if(/登录|扫码|sign in/i.test(dialogs))return {ready:false,reason:'manual_login_required'};
 const labels=[...document.querySelectorAll('span,p,div')].filter(visible).filter(e=>!e.children.length).map(e=>(e.innerText||'').trim()).filter(t=>t&&t.length<=100&&/抖音号/.test(t)).slice(0,10);
 const controls=[...document.querySelectorAll('button,a,[role="button"],span,div')].filter(visible).filter(e=>/^(私信|发私信|发消息|消息|关注|已关注|编辑资料)$/.test((e.innerText||'').trim())&&![...(e.children||[])].some(c=>(c.innerText||'').trim()===(e.innerText||'').trim())).slice(0,12).map(e=>({tag:e.tagName,marker:e.getAttribute('data-e2e'),className:e.getAttribute('class'),label:(e.innerText||'').trim(),href:e.getAttribute('href')}));
 const names=[...document.querySelectorAll('h1')].filter(visible).map(e=>(e.innerText||'').trim()).filter(t=>t&&t.length<=60);
 return {ready:document.readyState==='complete',url:location.href,title:document.title,labels,controls,profileNames:names};
}
export const profileSnapshotExpression=target=>{
 if(!profilePage(target))throw Error('Invalid profile snapshot target');
 return `(${captureProfile.toString()})(${JSON.stringify(target)})`;
};

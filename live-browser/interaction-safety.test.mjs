import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {pageRestriction} from './page-restriction.mjs';
import {interactionExpression} from './interaction-expression.mjs';
import {CdpConnection} from './browser-read.js';
import {EventEmitter} from 'node:events';
import {stopOwnBrowser,plan} from './browser-smoke.mjs';
function restrictionFixture({label='接收短信验证码',hidden=false,comment=false}={}){
 const node={innerText:label,children:[],closest:()=>comment?{}:null,getBoundingClientRect:()=>({width:200,height:40,top:10,bottom:50,left:10,right:210})};
 return {URL,location:{href:'https://www.douyin.com/jingxuan?modal_id=7551370789157637436'},innerHeight:800,innerWidth:1000,getComputedStyle:()=>({display:hidden?'none':'block',visibility:'visible',opacity:'1'}),document:{querySelectorAll:s=>s==='h1,h2,h3,[role="heading"],span,p,div'?[node]:[]}};
}
test('SMS overlay without dialog role blocks before pointer or text targeting',()=>{
 const scope=restrictionFixture();
 assert.equal(vm.runInNewContext(`(${pageRestriction.toString()})()`,scope),'verification');
 for(const phase of ['inspect','point_like','point_submit','input_guard']){
  const result=vm.runInNewContext(interactionExpression({phase,videoId:'7551370789157637436',text:'小鱼来加油'}),scope);
  assert.equal(result.ready,false);assert.equal(result.reason,'manual_verification_required');
 }
});
test('hidden labels and quoted verification words inside video comments do not grant or remove permissions',()=>{
 for(const opts of [{hidden:true},{comment:true},{label:'这个视频说接收短信验证码'}])assert.equal(vm.runInNewContext(`(${pageRestriction.toString()})()`,restrictionFixture(opts)),'');
});
test('login overlay without dialog role blocks native shares and mentions; quoted labels do not',()=>{
 for(const label of ['扫码登录','登录抖音','验证码登录','登录后即可私信']){
  assert.equal(vm.runInNewContext(`(${pageRestriction.toString()})()`,restrictionFixture({label})),'login');
  assert.equal(vm.runInNewContext(`(${pageRestriction.toString()})()`,restrictionFixture({label,comment:true})),'');
  for(const phase of ['point_mention_open','point_native_share_send'])assert.equal(vm.runInNewContext(interactionExpression({phase,videoId:'7551370789157637436',ownerPlatformId:'owner-id',ownerName:'老大',ownerAvatarResource:'/img/aweme-avatar/known-asset'}),restrictionFixture({label})).reason,'manual_login_required');
 }
});
function connection(){
 const listeners={},sent=[];
 const socket={addEventListener:(k,fn)=>listeners[k]=fn,close:()=>{},send:json=>{const q=JSON.parse(json);sent.push(q);queueMicrotask(()=>listeners.message({data:JSON.stringify({id:q.id,result:{}})}));}};
 return {c:new CdpConnection(socket),sent};
}

test('foreground permission is restricted to one previously verified session',async()=>{
 const {c,sent}=connection();
 await assert.rejects(c.send('Page.bringToFront',{},'page'),/not allowed/);
 c.armForegroundOnce('page');await assert.rejects(c.send('Page.bringToFront',{},'other'),/not allowed/);
 c.armForegroundOnce('page');await assert.rejects(c.send('Page.bringToFront',{extra:true},'page'),/not allowed/);
 c.armForegroundOnce('page');await c.send('Page.bringToFront',{},'page');
 await assert.rejects(c.send('Page.bringToFront',{},'page'),/not allowed/);
 assert.equal(sent.length,1);c.close();
});
test('pointer permit binds exact coordinates, session and a single press/release pair',async()=>{
 const {c,sent}=connection(),args={type:'mousePressed',x:10,y:20,button:'left',clickCount:1};
 await assert.rejects(c.send('Input.dispatchMouseEvent',args,'page'),/not allowed/);
 c.armPointerOnce({x:10,y:20},'page');
 await c.send('Input.dispatchMouseEvent',args,'page');
 await c.send('Input.dispatchMouseEvent',{...args,type:'mouseReleased'},'page');
 await assert.rejects(c.send('Input.dispatchMouseEvent',args,'page'),/not allowed/);
 c.armPointerOnce({x:10,y:20},'page');
 await assert.rejects(c.send('Input.dispatchMouseEvent',{...args,x:11},'page'),/not allowed/);
 await assert.rejects(c.send('Input.dispatchMouseEvent',args,'page'),/not allowed/);
 assert.equal(sent.length,2);c.close();
});
test('text permit is exact, single use, and cannot be used by another page',async()=>{
 const {c,sent}=connection();
 c.armTextInputOnce('小鱼','page');
 await assert.rejects(c.send('Input.insertText',{text:'小鱼'},'other'),/not allowed/);
 await assert.rejects(c.send('Input.insertText',{text:'小鱼'},'page'),/not allowed/);
 c.armTextInputOnce('小鱼','page');await c.send('Input.insertText',{text:'小鱼'},'page');
 await assert.rejects(c.send('Input.insertText',{text:'小鱼'},'page'),/not allowed/);
 assert.equal(sent.length,1);c.close();
});
test('hover permit is one move at a fixed point and cannot be converted into a click',async()=>{
 const {c,sent}=connection(),move={type:'mouseMoved',x:10,y:20};
 await assert.rejects(c.send('Input.dispatchMouseEvent',move,'page'),/not allowed/);
 c.armHoverOnce({x:10,y:20},'page');await assert.rejects(c.send('Input.dispatchMouseEvent',{...move,type:'mousePressed',button:'left',clickCount:1},'page'),/not allowed/);
 c.armHoverOnce({x:10,y:20},'page');await assert.rejects(c.send('Input.dispatchMouseEvent',move,'other'),/not allowed/);
 await assert.rejects(c.send('Input.dispatchMouseEvent',move,'page'),/not allowed/);
 c.armHoverOnce({x:10,y:20},'page');await c.send('Input.dispatchMouseEvent',move,'page');await assert.rejects(c.send('Input.dispatchMouseEvent',move,'page'),/not allowed/);
 assert.equal(sent.length,1);c.close();
});
test('delete permit allows only one Backspace down/up pair in its bound page',async()=>{
 const {c,sent}=connection(),args={type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8};
 await assert.rejects(c.send('Input.dispatchKeyEvent',args,'page'),/not allowed/);
 c.armDeleteSelectionOnce('page');await assert.rejects(c.send('Input.dispatchKeyEvent',{...args,key:'Enter'},'page'),/not allowed/);
 await assert.rejects(c.send('Input.dispatchKeyEvent',args,'page'),/not allowed/);
 c.armDeleteSelectionOnce('page');await assert.rejects(c.send('Input.dispatchKeyEvent',args,'other'),/not allowed/);
 c.armDeleteSelectionOnce('page');await c.send('Input.dispatchKeyEvent',args,'page');await c.send('Input.dispatchKeyEvent',{...args,type:'keyUp'},'page');
 await assert.rejects(c.send('Input.dispatchKeyEvent',args,'page'),/not allowed/);assert.equal(sent.length,2);c.close();
});
test('browser close requires a single-use browser-level permit',async()=>{
 const {c,sent}=connection();
 await assert.rejects(c.send('Browser.close'),/not allowed/);
 c.armBrowserCloseOnce();await assert.rejects(c.send('Browser.close',{},'page'),/not allowed/);
 c.armBrowserCloseOnce();await c.send('Browser.close');
 await assert.rejects(c.send('Browser.close'),/not allowed/);assert.equal(sent.length,1);c.close();
});
test('normal shutdown verifies exact owned listener and dedicated command line before Browser.close',async()=>{
 const child=Object.assign(new EventEmitter(),{pid:12345,exitCode:null,signalCode:null,kill(){throw Error('Must close normally');}});
 let armed=false,closed=false;
 const io={listListeners:async()=>[{pid:child.pid,address:'127.0.0.1'}],connect:async()=>({armBrowserCloseOnce(){armed=true;},send:async method=>{
  if(method==='Browser.getBrowserCommandLine')return {arguments:['--enable-automation','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--user-data-dir='+plan().profile]};
  assert.equal(method,'Browser.close');assert.equal(armed,true);child.exitCode=0;
 },close(){closed=true;}}),delay:async()=>{}};
 await stopOwnBrowser(child,io);assert.equal(child.fishCleanup,'graceful_verified_browser_close');assert.equal(closed,true);
});
test('foreign listener never receives a close request; only retained child can be terminated',async()=>{
 let connected=false,killed=false;
 const child=Object.assign(new EventEmitter(),{pid:12345,exitCode:null,signalCode:null,kill(){killed=true;this.exitCode=0;queueMicrotask(()=>this.emit('exit'));}});
 await stopOwnBrowser(child,{listListeners:async()=>[{pid:99999,address:'127.0.0.1'}],connect:async()=>{connected=true;throw Error('Must not attach');}});
 assert.equal(connected,false);assert.equal(killed,true);assert.equal(child.fishCleanup,'retained_child_termination_fallback');
});
test('slow normal shutdown can flush for more than five seconds without forced termination',async()=>{
 let elapsed=0,closeRequested=false;
 const child=Object.assign(new EventEmitter(),{pid:12345,exitCode:null,signalCode:null,kill(){throw Error('Must not interrupt profile flush');}});
 await stopOwnBrowser(child,{listListeners:async()=>[{pid:child.pid,address:'127.0.0.1'}],connect:async()=>({armBrowserCloseOnce(){},send:async method=>{
  if(method==='Browser.getBrowserCommandLine')return {arguments:['--enable-automation','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--user-data-dir='+plan().profile]};closeRequested=true;
 },close(){}}),delay:async ms=>{elapsed+=ms;if(elapsed>=10000)child.exitCode=0;}});
 assert.equal(closeRequested,true);assert.equal(elapsed,10000);assert.equal(child.fishCleanup,'graceful_verified_browser_close');
});
test('select-all permit is bound to one editor session and only one exact Ctrl+A pair',async()=>{
 const {c,sent}=connection(),p={type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65};
 await assert.rejects(c.send('Input.dispatchKeyEvent',p,'page'),/not allowed/);c.armSelectAllOnce('page');await assert.rejects(c.send('Input.dispatchKeyEvent',p,'other'),/not allowed/);
 c.armSelectAllOnce('page');await c.send('Input.dispatchKeyEvent',p,'page');await c.send('Input.dispatchKeyEvent',{...p,type:'keyUp'},'page');await assert.rejects(c.send('Input.dispatchKeyEvent',p,'page'),/not allowed/);assert.equal(sent.length,2);c.close();
});
test('wheel permit authorizes exactly one downward scroll on the bound page, never arbitrary movement',async()=>{
 const {c,sent}=connection(),p={type:'mouseWheel',x:100,y:200,deltaX:0,deltaY:700};await assert.rejects(c.send('Input.dispatchMouseEvent',p,'page'),/not allowed/);
 c.armWheelOnce({x:100,y:200},'page');await assert.rejects(c.send('Input.dispatchMouseEvent',{...p,deltaY:1400},'page'),/not allowed/);
 c.armWheelOnce({x:100,y:200},'page');await c.send('Input.dispatchMouseEvent',p,'page');await assert.rejects(c.send('Input.dispatchMouseEvent',p,'page'),/not allowed/);assert.equal(sent.length,1);c.close();
});

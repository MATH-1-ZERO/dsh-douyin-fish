import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {validateBrowserRecord,verifyBrowserArguments,buildRetainedLease,navigateExpression} from '../../src/retained-browser.js';
import {plan} from '../../src/browser/browser-smoke.mjs';import {runProfileSession} from '../../src/browser/scoped-ui.mjs';
import {readOneVideo} from '../../src/manual-browser.js';import {freshState,validateState} from '../../src/engine.js';
import {advanceRetainedVideo} from '../../src/retained-browser.js';
test('verification time counts toward the single-scroll observation deadline',async()=>{
 let time=0,checks=0,reads=0;
 const lease={verify:async()=>{checks++;if(checks>1)time+=8000;return {url:'https://www.douyin.com/video/7551370789157637436'};},read:async()=>{reads++;return {allowed:true,operationResult:{ready:true}};}};
 await assert.rejects(advanceRetainedVideo(lease,{},async ms=>{time+=ms;},()=>time),/no repeat/);
 assert.equal(reads,1);assert.equal(checks,3);
});
test('cancel during verification returns promptly without another scroll',async()=>{
 const controller=new AbortController();let checks=0,reads=0;
 const lease={verify:async signal=>{if(++checks===1)return {url:'https://www.douyin.com/video/7551370789157637436'};assert.ok(signal);controller.abort(Error('owner cancelled'));return new Promise(()=>{});},read:async()=>{reads++;return {allowed:true,operationResult:{ready:true}};}};
 await assert.rejects(advanceRetainedVideo(lease,{signal:controller.signal},async()=>{}),/owner cancelled/);assert.equal(reads,1);
});
test('already cancelled advance never inspects or scrolls',async()=>{
 const signal=AbortSignal.abort(Error('already cancelled'));
 await assert.rejects(advanceRetainedVideo({verify:async()=>{assert.fail('must not inspect');}},{signal}),/already cancelled/);
});
test('single scroll accepts delayed URL updates after five seconds without another wheel',async()=>{
 let checks=0,wheels=0,waits=0;const before='https://www.douyin.com/jingxuan?modal_id=7551370789157637436',after=before.replace('7551370789157637436','7699788489050574090');
 const result=await advanceRetainedVideo({verify:async()=>({url:++checks>30?after:before}),read:async()=>{wheels++;return {allowed:true,operationResult:{ready:true}};}},{},async()=>{waits++;});
 assert.equal(result.sourceRef,after);assert.equal(wheels,1);assert.equal(waits,30);
});
test('pre-wheel refusal preserves its reason and does not poll or retry',async()=>{
 for(const kind of ['guard','result','binding']){
  let reads=0,waits=0;const lease={verify:async()=>({url:'https://www.douyin.com/video/7551370789157637436'}),read:async()=>{reads++;if(kind==='result')return {allowed:true,operationResult:{ready:false,reason:'video_scroll_target_occluded'}};const e=Error(kind==='binding'?'Retained browser listener changed':'existing_input_preserved');if(kind==='guard')e.actionNotApplied=true;throw e;}};
  await assert.rejects(advanceRetainedVideo(lease,{},async()=>{waits++;}),/existing_input_preserved|video_scroll_target_occluded|listener changed/);assert.equal(reads,1);assert.equal(waits,0);
 }
});
test('wheel timeout only permits verification, never re-dispatch, and retains receipt error',async()=>{
 let reads=0,checks=0;const before='https://www.douyin.com/video/7551370789157637436',after=before.replace('7551370789157637436','7699788489050574090');
 const r=await advanceRetainedVideo({verify:async()=>({url:++checks>2?after:before}),read:async()=>{reads++;throw Error('CDP command timed out');}},{},async()=>{});
 assert.equal(reads,1);assert.equal(r.sourceRef,after);assert.match(r.scrollCommandReceiptError,/timed out/);
});
test('unchanged video ends after bounded read-only checks and no fallback action',async()=>{
 let reads=0,waits=0;await assert.rejects(advanceRetainedVideo({verify:async()=>({url:'https://www.douyin.com/video/7551370789157637436'}),read:async()=>{reads++;return {allowed:true,operationResult:{ready:true}};}},{},async()=>{waits++;}),/no repeat/);assert.equal(reads,1);assert.equal(waits,60);
});
const target='https://www.douyin.com/user/verified_owner_123',record={version:1,pid:12345,created:'2026-10-24T01:00:00.0000000Z',browserId:'browser-instance-123',targetId:'target-one-123'};
const args=['--enable-automation','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--user-data-dir='+plan().profile];
test('retained session refuses regular profiles, duplicate flags, non-loopback, private mode and malformed records',()=>{
 assert.equal(validateBrowserRecord(record),record);verifyBrowserArguments(args);
 for(const a of [[...args,'--remote-debugging-port=9223'],args.map(x=>x.replace('127.0.0.1','0.0.0.0')),[...args,'--inprivate'],args.filter(x=>!x.startsWith('--user-data-dir='))])assert.throws(()=>verifyBrowserArguments(a));
 for(const q of [{...record,pid:'12345'},{...record,browserId:'../browser'},{...record,endpoint:'http://remote'}])assert.throws(()=>validateBrowserRecord(q));
});
test('PID reuse, changed browser instance, foreign listener and extra tabs reject without navigation',async()=>{
 for(const fail of ['pid','instance','listener','tabs']){
  let closed=0;
  const c={browserId:fail==='instance'?'another-browser':record.browserId,close(){closed++;},send:async method=>method==='Browser.getBrowserCommandLine'?{arguments:args}:{targetInfos:fail==='tabs'?[{type:'page',targetId:record.targetId,url:target},{type:'page',targetId:'extra',url:target}]:[{type:'page',targetId:record.targetId,url:target}]}};
  const lease=await buildRetainedLease(record,{listListeners:async()=>[{address:'127.0.0.1',pid:fail==='listener'?99999:record.pid}],processIdentity:async()=>({created:fail==='pid'?'2026-10-24T02:00:00Z':record.created}),connect:async()=>c});
  await assert.rejects(lease.verify());if(['instance','tabs'].includes(fail))assert.equal(closed,1);
 }
});
test('public navigation preserves existing text and refuses route changes or login before assigning a destination',()=>{
 const from='https://www.douyin.com/?recommend=1',to='https://www.douyin.com/jingxuan';let destination;
 const input={value:'未发送内容',innerText:'',getBoundingClientRect:()=>({width:50,height:30})};
 const scope={URL,innerWidth:1000,innerHeight:800,location:{href:from,assign:v=>destination=v},getComputedStyle:()=>({visibility:'visible'}),document:{querySelectorAll:s=>s.includes('textarea')?[input]:[]}};
 assert.equal(vm.runInNewContext(navigateExpression(from,to),scope).reason,'existing_input_preserved');assert.equal(destination,undefined);
 input.value='';assert.equal(vm.runInNewContext(navigateExpression(from,to),scope).navigated,true);assert.equal(destination,to);
 scope.location.href=to;assert.equal(vm.runInNewContext(navigateExpression(from,to),scope).reason,'retained_page_changed');
 assert.throws(()=>navigateExpression(from,'https://evil.example/'));assert.throws(()=>navigateExpression(from,'https://www.douyin.com/im'));
});
test('retained profile runner reports retained lifecycle truthfully and never launches or closes a browser',async()=>{
 let checks=0,navigated;
 const report=await runProfileSession(target,async()=>({read:true}),{io:{reuseLease:{verify:async()=>{checks++;},navigate:async x=>navigated=x},launchBrowser:async()=>{throw Error('must not launch');},stopOwnBrowser:async()=>{throw Error('must not close');}}});
 assert.equal(navigated,target);assert.equal(checks,2);assert.equal(report.success,true);assert.equal(report.browserRetained,true);assert.equal(report.sessionReleased,true);assert.equal(report.ownBrowserStopped,false);assert.equal(report.portReleased,false);
});

test('profile runner preserves default refresh and allows the guarded owner panel flow to opt out',async()=>{
 for(const reloadIfSame of [undefined,false,true]){
  let options;
  const report=await runProfileSession(target,async()=>({read:true}),{...(reloadIfSame===undefined?{}:{reloadIfSame}),io:{reuseLease:{verify:async()=>{},navigate:async(_target,opts)=>options=opts}}});
  assert.equal(report.success,true);assert.equal(options.reloadIfSame,reloadIfSame??true);
 }
 await assert.rejects(runProfileSession(target,async()=>{}, {reloadIfSame:'false'}),/Invalid profile reload/);
});
test('video reader accepts only a fully verified retained lifecycle without fabricating stopped browser or released port',async()=>{
 for(const released of [true,false]){
  let s=freshState();const store={directory:'work/retained-lifecycle-'+released,snapshot:async()=>s,transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}};
  const result=await readOneVideo({manualBrowser:{enabled:true,readsPer24Hours:3,intervalMinutes:15}},{confirm:'read_one_public_video'},{store,now:()=>1800000000000,run:async()=>({success:true,pageRead:true,videoRead:true,bindingVerified:true,browserReused:true,browserRetained:true,sessionReleased:released,ownBrowserStopped:false,portReleased:false,readResult:{videoCaption:'猫在看雨'},pageMetadata:{url:'https://www.douyin.com/jingxuan?modal_id=7551370789157637436'}})});
  assert.equal(result.allowed,released);assert.equal(result.checks.ownBrowserStopped,false);assert.equal(result.checks.portReleased,false);
 }
});

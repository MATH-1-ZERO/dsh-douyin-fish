import test from 'node:test';
import assert from 'node:assert/strict';
import {ensurePageVisible} from '../../src/browser/page-visibility.mjs';

test('a visible page does not request foreground',async()=>{
 let raised=0;
 const result=await ensurePageVisible({inspect:async()=>({ready:true,pageVisible:true}),bringToFront:async()=>raised++,now:()=>0});
 assert.deepEqual(result,{ready:true,reason:null,pageVisible:true,foregroundAttempted:false,waitMs:0});assert.equal(raised,0);
});

test('foreground acknowledgement waits for delayed visibility before returning',async()=>{
 let time=0,reads=0,raised=0;const waits=[];
 const result=await ensurePageVisible({inspect:async()=>({ready:true,pageVisible:++reads>=3}),bringToFront:async()=>raised++,wait:async ms=>{waits.push(ms);time+=ms;},now:()=>time});
 assert.equal(result.ready,true);assert.equal(result.foregroundAttempted,true);assert.equal(result.waitMs,100);
 assert.equal(raised,1);assert.equal(reads,3);assert.deepEqual(waits,[100]);
});

test('a page staying hidden stops at the visibility deadline without a second foreground call',async()=>{
 let time=0,raised=0,reads=0;
 const result=await ensurePageVisible({inspect:async()=>{reads++;return {ready:true,pageVisible:false};},bringToFront:async()=>raised++,wait:async ms=>{time+=ms;},now:()=>time,timeoutMs:300});
 assert.deepEqual(result,{ready:false,reason:'owner_dm_page_hidden',pageVisible:false,foregroundAttempted:true,waitMs:300});
 assert.equal(raised,1);assert.equal(reads,4);
});

test('an actual inspection error is preserved without calling it a hidden page',async()=>{
 for(const failureAfterRaise of [false,true]){
  let reads=0,raised=0;
  const result=await ensurePageVisible({inspect:async()=>++reads===1&&failureAfterRaise?{ready:true,pageVisible:false}:{ready:false,reason:'manual_verification_required'},bringToFront:async()=>raised++,now:()=>0});
  assert.equal(result.ready,false);assert.equal(result.reason,'manual_verification_required');assert.equal(raised,failureAfterRaise?1:0);
 }
});

test('missing or nonboolean visibility is never accepted as visible',async()=>{
 for(const value of [undefined,null,1,'visible']){
  let raised=0;
  const result=await ensurePageVisible({inspect:async()=>({ready:true,pageVisible:value}),bringToFront:async()=>raised++,now:()=>0});
  assert.equal(result.ready,false);assert.equal(result.pageVisible,false);assert.equal(result.reason,'owner_dm_visibility_unavailable');assert.equal(raised,0);
 }
});

test('cancellation after each awaited operation is observed before proceeding',async()=>{
 for(const stage of ['inspect','foreground','wait']){
  const controller=new AbortController();let raised=0,waited=0,reads=0;
  await assert.rejects(ensurePageVisible({signal:controller.signal,
   inspect:async()=>{reads++;if(stage==='inspect')controller.abort();return {ready:true,pageVisible:false};},
   bringToFront:async()=>{raised++;if(stage==='foreground')controller.abort();},
   wait:async()=>{waited++;if(stage==='wait')controller.abort();},now:()=>0}),{name:'AbortError'});
  assert.equal(raised,stage==='inspect'?0:1);assert.equal(waited,stage==='wait'?1:0);assert.equal(reads,stage==='wait'?2:1);
 }
});

test('slow inspections count against the soft deadline and do not start further polls',async()=>{
 let time=0,reads=0,raised=0,waited=0;
 const result=await ensurePageVisible({inspect:async()=>{time+=++reads===1?60:240;return {ready:true,pageVisible:false};},bringToFront:async()=>{raised++;time+=10;},wait:async()=>waited++,now:()=>time,timeoutMs:300});
 assert.equal(result.ready,false);assert.equal(result.reason,'owner_dm_page_hidden');assert.equal(result.waitMs,310);
 assert.equal(reads,2);assert.equal(raised,1);assert.equal(waited,0);
});

test('a slow foreground call does not start a visibility poll beyond the deadline',async()=>{
 let time=0,reads=0;
 const result=await ensurePageVisible({inspect:async()=>{reads++;return {ready:true,pageVisible:false};},bringToFront:async()=>{time+=301;},now:()=>time,timeoutMs:300});
 assert.equal(result.ready,false);assert.equal(result.waitMs,301);assert.equal(reads,1);
});

test('a nonadvancing injected clock still has a finite poll count',async()=>{
 let reads=0,raised=0;
 const result=await ensurePageVisible({inspect:async()=>{reads++;return {ready:true,pageVisible:false};},bringToFront:async()=>raised++,wait:async()=>{},now:()=>0,timeoutMs:300});
 assert.equal(result.ready,false);assert.equal(raised,1);assert.equal(reads,5);
});

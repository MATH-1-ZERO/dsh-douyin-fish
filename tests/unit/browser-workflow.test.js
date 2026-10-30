import test from 'node:test';import assert from 'node:assert/strict';
import {freshState,validateState} from '../../src/engine.js';
import {reserveBrowserWorkflow,reserveBrowserStage} from '../../src/browser-workflow.js';
const time=1800000000000,settings={manualBrowser:{enabled:true,readsPer24Hours:4,intervalMinutes:15}};
function fixture(){let state=freshState();const store={snapshot:async()=>structuredClone(state),transact:async fn=>{const r=await fn(structuredClone(state));validateState(r.state);state=r.state;return r.value;}};return {store,state:()=>state};}
test('workflow reserves all stages up front without evading daily cap or cooldown',async()=>{
 const f=fixture(),r=await reserveBrowserWorkflow(settings,f.store,{stages:3,now:time});assert.equal(r.allowed,true);assert.deepEqual(f.state().resources.manualBrowserReads,[time-2,time-1,time]);
 for(let i=0;i<3;i++)assert.equal((await reserveBrowserStage(settings,f.store,r.ticket,time+1000)).allowed,true);
 assert.equal((await reserveBrowserStage(settings,f.store,r.ticket,time+1000)).allowed,false);
 assert.equal((await reserveBrowserWorkflow(settings,f.store,{now:time+1000})).reason,'manual_browser_cooldown');
 const g=fixture(),denied=await reserveBrowserWorkflow({...settings,manualBrowser:{...settings.manualBrowser,readsPer24Hours:2}},g.store,{stages:3,now:time});assert.equal(denied.reason,'browser_workflow_daily_limit');assert.equal(g.state().resources.manualBrowserReads,undefined);
});
test('tickets cannot be forged, moved to another store, reused after expiry or used after limits change',async()=>{
 const f=fixture(),r=await reserveBrowserWorkflow(settings,f.store,{now:time});
 assert.equal((await reserveBrowserStage(settings,f.store,{},time)).allowed,false);
 assert.equal((await reserveBrowserStage(settings,fixture().store,r.ticket,time)).allowed,false);
 assert.equal((await reserveBrowserStage({...settings,manualBrowser:{...settings.manualBrowser,enabled:false}},f.store,r.ticket,time)).allowed,false);
 assert.equal((await reserveBrowserStage(settings,f.store,r.ticket,time+180001)).allowed,false);
});
test('development stage reservations preserve all production usage and count real test stages separately',async()=>{
 const f=fixture();await f.store.transact(s=>{s.resources.development={enabled:true,readsTotal:7,lastReadAt:time-1};s.resources.manualBrowserReads=[time-1];return {state:s,value:null};});
 assert.equal((await reserveBrowserWorkflow(settings,f.store,{now:time})).allowed,true);assert.equal(f.state().resources.development.readsTotal,10);assert.deepEqual(f.state().resources.manualBrowserReads,[time-1]);
});

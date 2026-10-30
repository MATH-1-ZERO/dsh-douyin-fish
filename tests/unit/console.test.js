import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {FishConsole} from '../../src/console-server.js';
import {consoleView} from '../../src/console-view.js';
import {freshState} from '../../src/engine.js';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';

test('the shipped browser entry parses as the classic script served by the console',async()=>{
 const source=await readFile(new URL('../../console/app.js',import.meta.url),'utf8');
 assert.doesNotThrow(()=>new Script(source));
});

test('console snapshot projects actual counts and the newest owner receipt without mutating state',()=>{
 const s=freshState(),now=Date.parse('2026-10-28T12:00:00Z');
 s.resources.persona={name:'小鱼',ownerId:'owner',ownerAddress:'老大',schedule:{enabled:false},personaText:'private persona',voice:'private voice'};
 s.resources.ownerIdentity={verified:true,platformId:'owner'};
 s.resources.interactionAttempts=[{id:'first',kind:'dm',at:now-1000,status:'confirmed',ownerConfirmedReceived:true},{id:'second',kind:'dm',at:now,status:'confirmed',ownerConfirmedReceived:true}];
 s.resources.ownerReplies={events:[{attemptId:'first',status:'confirmed',ownerConfirmedReceived:true,ownerReportAt:now-1000},{attemptId:'second',status:'confirmed',ownerConfirmedReceived:true,ownerReportAt:now}]};
 s.resources.memory.recent=[{kind:'note',text:'private memory',time:now}];s.resources.memory.total=1;
 const original=structuredClone(s),v=consoleView(s,{version:'test',now,runtime:{canControl:true}});
 assert.equal(v.replies.latestOwnerReceiptAt,now);assert.equal(v.runtime.scheduleEnabled,false);assert.equal(v.counts.ownerReceipts,2);assert.equal(v.usage.balance,null);assert.equal(v.usage.actualTokens,null);assert.deepEqual(s,original);
 const guest=consoleView(s,{role:'guest',now,runtime:{canControl:true}});
 for(const key of ['memory','replies','timeline','persona','owner','usage'])assert.equal(Object.hasOwn(guest,key),false,key);
 assert.equal(guest.runtime.canControl,false);assert.ok(!JSON.stringify(guest).includes('private'));
});

async function fixture(t){
 let actions=0;
 const server=new FishConsole({snapshot:async role=>role==='owner'?{role,secret:'private note'}:{role},commands:{pause:async()=>{actions++;return {paused:true};},remember_note:async({text})=>{actions++;return {allowed:true,text};}}});
 const opened=await server.open(),url=new URL(opened.url),origin=url.origin,token=new URLSearchParams(url.hash.slice(1)).get('access');
 t.after(()=>server.close());
 const api=(path,body,key=token,headers={})=>fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json',Origin:origin}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 return {server,origin,token,api,get actions(){return actions;}};
}
test('console is lazy, local-only and concurrent opens share one protected server',async t=>{
 const f=await fixture(t),[a,b]=await Promise.all([f.server.open(),f.server.open()]);
 assert.equal(a.url,b.url);assert.equal(new URL(a.url).hostname,'127.0.0.1');
 const page=await fetch(f.origin);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok(!(await page.text()).includes(f.token));
 assert.equal((await fetch(f.origin+'/api/view')).status,401);assert.equal((await f.api('/api/view',null,'wrong')).status,401);
 assert.equal((await f.api('/api/view')).status,200);assert.equal(f.actions,0);
});
test('guest capability cannot read private projections or invoke owner actions',async t=>{
 const f=await fixture(t),created=await (await f.api('/api/action',{action:'guest_preview'})).json();
 const guest=new URLSearchParams(new URL(created.url).hash.slice(1)).get('access');
 assert.deepEqual(await(await f.api('/api/view',null,guest)).json(),{role:'guest'});
 for(const action of ['pause','remember_note','guest_preview','refresh_billing','open_browser','scan_conversations','save_replies','save_persona','start_plugin'])assert.equal((await f.api('/api/action',{action,text:'secret'},guest)).status,403);
 assert.equal(f.actions,0);
});
test('owner action requires same-origin JSON and an explicit allowlisted operation',async t=>{
 const f=await fixture(t);
 assert.equal((await f.api('/api/action',{action:'pause'},f.token,{Origin:'http://evil.invalid'})).status,403);
 assert.equal((await f.api('/api/action',{action:'pause'},f.token,{'Content-Type':'text/plain'})).status,403);
 assert.equal((await f.api('/api/action',{action:'arbitrary_tool'})).status,400);
 assert.equal((await f.api('/api/action',{action:'pause',recipient:'someone'})).status,400);
 assert.equal((await f.api('/api/action',{action:'remember_note',text:'x'.repeat(161)})).status,400);
 assert.equal(f.actions,0);assert.equal((await f.api('/api/action',{action:'pause'})).status,200);assert.equal(f.actions,1);
 const note=await(await f.api('/api/action',{action:'remember_note',text:'主人偏好简短回复'})).json();assert.equal(note.text,'主人偏好简短回复');
});
test('foreign Host is refused and closing the console revokes its old access token',async t=>{
 const f=await fixture(t);
 const status=await new Promise((resolve,reject)=>{const req=request(f.origin+'/api/view',{headers:{Host:'evil.invalid',Authorization:'Bearer '+f.token}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,403);
 await f.server.close();assert.equal(f.server.status().running,false);
 const reopened=await f.server.open();const newOrigin=new URL(reopened.url).origin;
 assert.equal((await fetch(newOrigin+'/api/view',{headers:{Authorization:'Bearer '+f.token}})).status,401);
});

test('console launch acknowledgement counts only successful authenticated owner views and resets on reopen',async t=>{
 const f=await fixture(t);assert.equal(f.server.status().ownerViewCount,0);
 await fetch(f.origin);await fetch(f.origin+'/api/view');assert.equal(f.server.status().ownerViewCount,0);
 await f.api('/api/view');assert.equal(f.server.status().ownerViewCount,1);
 await f.server.close();await f.server.open();assert.equal(f.server.status().ownerViewCount,0);
});

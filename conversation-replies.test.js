import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshState,validateState} from './engine.js';
import {replyDefaults,settingsPatch,digest,validateReplySettings,selectedConversation} from './conversation-state.js';
import {ConversationReplies} from './conversation-replies.js';
import {ConsoleOperations} from './console-operations.js';
import {interactionDecision,validateIntent,interactionTargetHash} from './interaction-gate.js';
import {consoleView} from './console-view.js';
import {prepareDedicatedBrowser} from './browser-control.js';
const base=JSON.parse(await readFile(new URL('./settings.json',import.meta.url),'utf8'));
const persona=JSON.parse(await readFile(new URL('./personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
function fixture(){
 let state=freshState(),messages={owner:[],friend:[],other:[]},models=0,sends=0,status='confirmed',time=Date.parse('2026-10-29T12:00:00+08:00');
 state.resources.persona=structuredClone(persona);state.resources.persona.ownerId='verified_owner_123';state.resources.persona.schedule.enabled=false;
 state.resources.ownerIdentity={verified:true,platformId:'verified_owner_123',ownerHandle:'owner_handle'};
 state.resources.development={enabled:true,readsTotal:0,lastReadAt:null};
 const contact=name=>{const c={name,avatar:'https://images.test/'+name,account:'https://images.test/self'};return {...c,id:digest([c.account,c.name,c.avatar])};};
 const owner=contact('owner'),friend=contact('friend'),other=contact('other');state.resources.conversations={at:time,ownerId:owner.id,items:[owner,friend,other]};
 state.resources.replySettings={...replyDefaults,ownerEnabled:true,selected:[friend.id]};
 const store={snapshot:async()=>structuredClone(state),transact:async fn=>{const r=await fn(structuredClone(state));validateState(r.state);state=r.state;return r.value;}};
 const read=async c=>({allowed:true,recipientIdentityVerified:true,messages:messages[c.name].map(text=>({text,localMessageKey:digest([c.name,text])}))});
 const generate=async(p,{commit})=>{models++;return commit('收到啦，一起加油！');};
 const send=async()=>{sends++;return {allowed:status==='confirmed',interaction:{status,attemptId:'12345678-1234-1234-1234-'+String(sends).padStart(12,'0')}};};
 const worker=new ConversationReplies({store,loadBase:async()=>base,generate,read,send,readOwner:async()=>read(owner),sendOwner:send,setTimer:()=>({unref(){}}),clearTimer(){},now:()=>++time});
 return {store,worker,friend,other,owner,get state(){return state;},get sends(){return sends;},get models(){return models;},messages(name,text){messages[name]=text;},set outcome(v){status=v;}};
}
test('reply settings validate ranges and reject undeclared recipient IDs and permission fields',()=>{
 const f=fixture();assert.throws(()=>settingsPatch(f.state,{selected:['f'.repeat(64)]}),/expired/);
 for(const patch of [{pollSeconds:0},{selected:[f.friend.id,f.friend.id]},{defaultText:''},{defaultText:'https://x.test'},{maxCharacters:101},{defaultEnabled:'true'},{ownerId:'forged'}])assert.throws(()=>validateReplySettings({...replyDefaults,...patch}));
 assert.equal(settingsPatch(f.state,{ownerEnabled:false}).ownerEnabled,false);
});
test('owner and selected contact baseline, two new replies, dedup and zero retained generated text',async()=>{
 const f=fixture();f.messages('owner',['历史']);f.messages('friend',['旧消息']);assert.equal((await f.worker.start()).allowed,true);await f.worker.tick();assert.equal(f.sends,0);
 f.messages('owner',['新消息一']);const first=await f.worker.tick();assert.equal(first.allowed,true,JSON.stringify(first));f.messages('friend',['新消息二']);await f.worker.tick();assert.equal(f.sends,2);assert.equal(f.models,2);await f.worker.tick();assert.equal(f.sends,2);
 assert.equal(f.state.resources.manualDrafts.length,0);assert.equal(f.state.resources.conversationReplies.events.filter(e=>e.status==='confirmed').length,2);
 assert.ok(f.state.resources.requests.every(q=>q.result===null));await f.worker.stop();assert.equal(f.state.paused,true);
});
test('default replies only cover loaded non-owner non-selected conversations and need no model',async()=>{
 const f=fixture();await f.store.transact(s=>{s.resources.replySettings={...replyDefaults,ownerEnabled:false,selected:[],defaultEnabled:true};return {state:s,value:null};});
 await f.worker.start();await f.worker.tick();f.messages('owner',['不要发给主人']);f.messages('other',['你好']);await f.worker.tick();assert.equal(f.sends,1);assert.equal(f.models,0);await f.worker.tick();assert.equal(f.sends,1);
 f.messages('other',['第二条']);await f.worker.tick();assert.equal(f.sends,2);await f.worker.stop();
});
test('uncertain delivery pauses and blocks a new start without resending',async()=>{
 const f=fixture();await f.worker.start();await f.worker.tick();f.messages('owner',['新消息']);f.outcome='uncertain';await f.worker.tick();assert.equal(f.state.paused,true);assert.equal(f.worker.live,false);assert.equal((await f.worker.start()).reason,'interaction_result_unresolved');assert.equal(f.sends,1);
});
test('pause during model generation cannot submit or send its late response',async()=>{
 const f=fixture();await f.worker.start();await f.worker.tick();f.messages('owner',['新的问题']);let release,entered;const ready=new Promise(r=>entered=r);
 f.worker.generate=async(p,{commit})=>{entered();await new Promise(r=>release=r);return commit('迟到的回复');};
 const tick=f.worker.tick();await ready;const stopped=f.worker.stop();release();await Promise.all([tick,stopped]);assert.equal(f.sends,0);assert.equal(f.state.paused,true);assert.equal(f.worker.live,false);
});
test('pause during startup model probe prevents arming any polling timer',async()=>{
 const f=fixture();let release,entered;const ready=new Promise(r=>entered=r);f.worker.generate.probe=async()=>{entered();await new Promise(r=>release=r);};const starting=f.worker.start();await ready;await f.worker.stop();release();assert.equal((await starting).allowed,false);assert.equal(f.worker.live,false);assert.equal(f.state.paused,true);
});
test('read identity failures stop the worker without model or send calls',async()=>{
 const f=fixture();f.worker.readOwner=async()=>({allowed:false,reason:'conversation_account_changed'});await f.worker.start();assert.equal((await f.worker.tick()).allowed,false);assert.equal(f.models,0);assert.equal(f.sends,0);assert.equal(f.state.paused,true);
});
test('owner stop phrase pauses both recipient branches',async()=>{
 const f=fixture();await f.worker.start();await f.worker.tick();f.messages('owner',['暂停']);f.messages('friend',['你好']);await f.worker.tick();assert.equal(f.worker.live,false);assert.equal(f.sends,0);
});
test('UI conversation gate requires an active lease and selected directory identity',async()=>{
 const f=fixture(),intent={kind:'dm',identityKind:'selected_douyin_conversation',recipientId:f.friend.id,sourceRef:'douyin-conversation:'+f.friend.id,text:'收到'};
 assert.equal(interactionDecision(f.state,intent).allowed,false);
 await f.worker.start();await f.store.transact(s=>{s.resources.conversationReplies.lease='lease';return {state:s,value:null};});assert.equal(interactionDecision(f.state,intent).allowed,true);
 assert.equal(interactionDecision(f.state,{...intent,recipientId:f.other.id,sourceRef:'douyin-conversation:'+f.other.id}).reason,'conversation_not_authorized');
 assert.notEqual(interactionTargetHash(validateIntent({...intent,inReplyTo:'a'.repeat(64)})),interactionTargetHash(validateIntent({...intent,inReplyTo:'b'.repeat(64)})));
});
test('guest projections omit every private control setting and contact identifier',()=>{
 const f=fixture(),v=consoleView(f.state,{role:'guest'});for(const k of ['conversations','replySettings','browser','conversationReplies'])assert.equal(Object.hasOwn(v,k),false);assert.ok(!JSON.stringify(v).includes(f.friend.id));
});
test('console settings save pauses first, preserves histories and does not start a worker',async()=>{
 const f=fixture();let stops=0,starts=0;const ops=new ConsoleOperations({store:f.store,loadBase:async()=>base,replies:{start(){starts++;}},stopAll:async()=>{stops++;await f.worker.stop();}});
 const saved=await ops.commands().save_replies({changes:{pollSeconds:45,ownerEnabled:false}});assert.equal(saved.allowed,true);assert.equal(f.state.resources.replySettings.pollSeconds,45);assert.equal(f.state.resources.persona.schedule.enabled,false);assert.equal(starts,0);assert.equal(stops,1);
 assert.equal((await ops.commands().save_persona({changes:{name:'可爱小鱼',ownerAddress:'老板'}})).allowed,true);assert.equal(f.state.resources.persona.name,'可爱小鱼');assert.equal(f.state.resources.ownerIdentity.platformId,'verified_owner_123');
 assert.equal((await ops.commands().save_persona({changes:{ownerId:'forged'}})).allowed,false);
});
test('pause cancels a pending browser preparation before reply start',async()=>{
 const f=fixture();let release,entered,starts=0;const ready=new Promise(r=>entered=r);const ops=new ConsoleOperations({store:f.store,loadBase:async()=>base,replies:{start(){starts++;}},stopAll:()=>f.worker.stop(),io:{prepareDedicatedBrowser:async()=>{entered();await new Promise(r=>release=r);return {allowed:true,browser:{bindingVerified:true}};}}});
 const starting=ops.commands().start_plugin({mode:'replies'});await ready;const stopped=ops.pause();release();await Promise.all([starting,stopped]);assert.equal(starts,0);assert.equal(f.state.paused,true);
});
test('browser reconnect revalidates a live dedicated instance and never launches or closes it',async()=>{
 let adopted=0;const r=await prepareDedicatedBrowser({io:{listListeners:async()=>[{pid:11,address:'127.0.0.1'}],adoptRetainedBrowser:async()=>{adopted++;return {allowed:true};},retainedBrowserStatus:async()=>({bindingVerified:true,pid:11}),launch(){assert.fail('must reuse');},stopOwnBrowser(){assert.fail('must retain');}}});assert.equal(r.allowed,true);assert.equal(adopted,1);assert.equal(r.opened,false);
});

test('a new start cannot overlap asynchronous pause cleanup',async()=>{
 const f=fixture();let release,starts=0;
 const ops=new ConsoleOperations({store:f.store,loadBase:async()=>base,replies:{start(){starts++;}},stopAll:()=>new Promise(r=>release=r)});
 const pausing=ops.pause();assert.equal(ops.busy,true);
 const result=await ops.commands().start_plugin({mode:'replies'});assert.equal(result.reason,'console_operation_in_progress');assert.equal(starts,0);
 release({allowed:true});await pausing;assert.equal(ops.busy,false);
});

test('an exact confirmed receipt reconciles a prior uncertain reply event without resending',async()=>{
 const f=fixture();await f.worker.start();await f.worker.tick();f.messages('owner',['需要核对的消息']);f.outcome='uncertain';await f.worker.tick();assert.equal((await f.worker.start()).allowed,false);
 await f.store.transact(s=>{const event=s.resources.conversationReplies.events[0];(s.resources.interactionAttempts??=[]).push({id:event.attemptId,key:'a'.repeat(64),kind:'dm',at:event.at,status:'confirmed',receiptId:'ui-verified-original-reply'});return {state:s,value:null};});
 assert.equal((await f.worker.start()).allowed,true);await f.worker.tick();assert.equal(f.state.resources.conversationReplies.events[0].status,'confirmed');assert.equal(f.sends,1);assert.equal(f.models,1);await f.worker.stop();
});

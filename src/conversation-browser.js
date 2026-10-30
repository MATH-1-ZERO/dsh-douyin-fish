import {mkdir,rmdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {loadRetainedLease} from './retained-browser.js';
import {conversationsExpression} from './browser/conversations-ui.mjs';
import {conversationSendExpression} from './browser/owner-dm-send-expression.mjs';
import {digest} from './conversation-state.js';
import {dispatchInteraction,interactionTargetHash} from './interaction-gate.js';
import {reloadOwnerDocument,waitForOwnerDmVisibleReceipt} from './owner-dm.js';
import {reserveBrowserStage} from './browser-workflow.js';
import {effectiveSettings} from './persona.js';
import {waitForStableReceipt} from './interaction-settle.js';

async function session(store,signal,operation,options={}){
 await mkdir(store.directory,{recursive:true});const lock=join(store.directory,'.manual-browser-running');
 try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')throw Error('browser_busy_or_stale_lock');throw e;}
 let c;
 try{
  const settings=options.settings??effectiveSettings(JSON.parse(await readFile(new URL('../config/default-settings.json',import.meta.url),'utf8')),await store.snapshot());
  const reserved=await reserveBrowserStage(settings,store,options.browserWorkflow);if(!reserved.allowed)throw Error(reserved.reason);
  signal?.throwIfAborted();const lease=await loadRetainedLease();if(!lease)throw Error('dedicated_browser_binding_required');
  const page=await lease.verify(signal);c=await lease.connect(undefined,signal);
  const {sessionId}=await c.send('Target.attachToTarget',{targetId:page.targetId,flatten:true});
  c.armForegroundOnce(sessionId);await c.send('Page.bringToFront',{},sessionId);
  const frame=async()=>{const f=(await c.send('Page.getFrameTree',{},sessionId)).frameTree.frame;if(f.url!==page.url)throw Error('conversation_page_changed');return f;};
  const evaluate=async expression=>{signal?.throwIfAborted();const f=await frame();const {executionContextId}=await c.send('Page.createIsolatedWorld',{frameId:f.id,worldName:'fish-conversations'},sessionId);const r=await c.send('Runtime.evaluate',{contextId:executionContextId,expression,returnByValue:true,timeout:1000},sessionId);if(r.exceptionDetails)throw Error('conversation_page_read_failed');return r.result.value;};
  const ui=(phase,contact)=>evaluate(conversationsExpression({page:page.url,phase,...contact}));
  const click=async(phase,contact)=>{const a=await ui(phase,contact);if(!a?.ready||!a.point)throw Error(a?.reason||'conversation_control_unavailable');const b=await ui(phase,contact);if(!b?.ready||b.point?.x!==a.point.x||b.point?.y!==a.point.y)throw Error('conversation_control_moved');c.armPointerOnce(a.point,sessionId);for(const type of ['mousePressed','mouseReleased'])await c.send('Input.dispatchMouseEvent',{type,...a.point,button:'left',clickCount:1},sessionId);};
  const list=async()=>{
   let clickedBack=false,clickedOpen=false;
   for(let i=0;i<40;i++){
    const p=await ui('list');if(!p?.ready)throw Error(p?.reason||'conversation_list_unavailable');
    if(p.conversationOpen){if(!clickedBack){await click('back');clickedBack=true;}}
    else if(p.listOpen)return p;
    else if(!clickedOpen){await click('open');clickedOpen=true;}
    await delay(250,undefined,{signal});
   }
   throw Error('conversation_list_timeout');
  };
  const select=async contact=>{const p=await list();if(p.account!==contact.account)throw Error('conversation_account_changed');if(p.items.filter(x=>x.name===contact.name&&x.avatar===contact.avatar).length!==1)throw Error('conversation_selection_changed');await click('select',contact);
   for(let i=0;i<40;i++){await delay(250,undefined,{signal});const r=await evaluate(conversationSendExpression({profile:page.url,conversation:contact,phase:'inspect',text:'conversation_identity_check'}));if(r.ready)return;if(!['conversation_identity_changed','owner_conversation_changed'].includes(r.reason))throw Error(r.reason);}
   throw Error('conversation_identity_changed');
  };
  const result=await operation({c,sessionId,page,evaluate,frame,list,select});
  // An open list covers the profile's DM button. Leave a clean, empty panel
  // after a successful read/send so the verified-owner path can run next.
  if(result.allowed){
   await list();let closeReady=false;
   for(let i=0;i<20;i++){const p=await ui('close_list');if(p.ready&&p.point){closeReady=true;break;}if(!['conversation_close_unbound','conversation_control_occluded'].includes(p.reason))throw Error(p.reason||'conversation_close_failed');await delay(250,undefined,{signal});}
   if(!closeReady)throw Error('conversation_close_unbound');
   await click('close_list');let closed=false;
   for(let i=0;i<20;i++){const p=await ui('list');if(!p?.ready)throw Error(p?.reason||'conversation_close_failed');if(!p.listOpen&&!p.conversationOpen){closed=true;break;}await delay(250,undefined,{signal});}
   if(!closed)throw Error('conversation_close_timeout');
  }
  return result;
 }finally{c?.close();await rmdir(lock);}
}
export async function scanConversations({store,signal,...options}){
 return session(store,signal,async({list})=>{const p=await list();const items=p.items.map(x=>({...x,account:p.account,id:digest([p.account,x.name,x.avatar])}));const counts=new Map();for(const x of items)counts.set(x.id,(counts.get(x.id)||0)+1);return {allowed:true,items:items.filter(x=>counts.get(x.id)===1),loadedOnly:true,skipped:p.skipped+items.filter(x=>counts.get(x.id)>1).length,sendingPerformed:false};},options);
}
export async function readConversation(contact,{store,signal,...options}){
 return session(store,signal,async({select,page,evaluate})=>{await select(contact);let previous,stable=0,result;
  for(let i=0;i<8;i++){result=await evaluate(conversationSendExpression({profile:page.url,conversation:contact,phase:'inbox',text:'conversation_inbox_read'}));if(!result.ready)throw Error(result.reason);const key=JSON.stringify(result.messages);stable=key===previous?stable+1:1;previous=key;if(stable>=2)break;await delay(500,undefined,{signal});}
  return {allowed:true,recipientIdentityVerified:true,messages:result.messages.map(m=>({text:m.text,localMessageKey:digest([contact.id,'incoming',m.text])})),sendingPerformed:false};
 },options);
}
export async function sendConversation(contact,text,{store,signal,settings,inReplyTo,browserWorkflow}){
 return session(store,signal,async({select,page,evaluate,c,sessionId,frame})=>{
  await select(contact);let previousMatches=0;const operation=phase=>evaluate(conversationSendExpression({profile:page.url,conversation:contact,phase,text,previousMatches}));
  const intent={kind:'dm',identityKind:'selected_douyin_conversation',recipientId:contact.id,sourceRef:'douyin-conversation:'+contact.id,text,inReplyTo};
  const interaction=await dispatchInteraction({store,intent,limits:settings.interactionLimits,signal,adapter:{
   inspectTarget:async target=>{const p=await operation('inspect');previousMatches=p.matches?.length??0;return {ready:p.ready&&p.editorEmpty,targetHash:interactionTargetHash(target)};},
   sendOnce:async target=>{
    let p=await operation('input_guard');if(!p.ready){const e=Error(p.reason);e.actionNotApplied=true;throw e;}
    c.armTextInputOnce(text,sessionId);await c.send('Input.insertText',{text},sessionId);p=await operation('verify_input');if(!p.ready||!p.filled)throw Error('conversation_input_not_verified');
    p=await operation('point_send');if(!p.ready)throw Error(p.reason);c.armPointerOnce(p.point,sessionId);for(const type of ['mousePressed','mouseReleased'])await c.send('Input.dispatchMouseEvent',{type,...p.point,button:'left',clickCount:1},sessionId);
    const visible=await waitForOwnerDmVisibleReceipt({operation:async phase=>{const p=await operation(phase);return {...p,matches:p.matches?.length===previousMatches+1?p.matches.slice(-1):[]};},signal});if(!visible)return {verified:false};
    const refreshed=await reloadOwnerDocument({inspect:async()=>({targetId:page.targetId,...await frame(),frameId:(await frame()).id}),refreshOnce:()=>operation('refresh_profile'),signal});if(!refreshed.ready)throw Error(refreshed.reason);
    await delay(1000,undefined,{signal});await select(contact);
    for(let i=0,stable=0;i<12;i++){const p=await operation('receipt');if(!p.ready)throw Error(p.reason);if(p.editorEmpty&&p.matches.length===previousMatches+1&&!p.matches.at(-1).pendingOrFailed&&p.matches.at(-1).layout?.flexDirection==='row-reverse'){if(++stable>=3)return {verified:true,targetHash:interactionTargetHash(target),receiptId:'ui-conversation:'+interactionTargetHash(target)};}else stable=0;await delay(500,undefined,{signal});}
    return {verified:false};
   }
  }});
  return {allowed:interaction.status==='confirmed',interaction,sent:interaction.status==='confirmed'?true:interaction.attemptId?null:false,reason:interaction.reason??interaction.error??interaction.status};
 },{settings,browserWorkflow});
}
export async function verifyConversationCard(contact,videoId,{store,signal,...options},afterSend=false){
 return session(store,signal,async({select,page,evaluate,frame})=>{
  await select(contact);const operation=phase=>evaluate(conversationSendExpression({profile:page.url,conversation:contact,phase,text:'native_video_card',nativeCardVideoId:videoId}));
  if(!afterSend){const p=await operation('card_receipt');if(!p.ready||!p.editorEmpty||p.matches.length)throw Error(p.reason||'native_card_already_present');return {allowed:true,verifiedAt:Date.now()};}
  const accept=p=>p?.ready&&p.editorEmpty&&p.matches?.length===1&&p.matches[0].outgoing&&p.matches[0].nativeVideoCard;
  const initial=await waitForStableReceipt(()=>operation('card_receipt'),accept,{signal,minimumMs:1000});if(!initial)return {allowed:false,reason:'native_card_receipt_unverified'};
  const refreshed=await reloadOwnerDocument({inspect:async()=>{const f=await frame();return {targetId:page.targetId,frameId:f.id,loaderId:f.loaderId};},refreshOnce:()=>operation('refresh_profile'),signal});if(!refreshed.ready)throw Error(refreshed.reason);
  await delay(1000,undefined,{signal});await select(contact);
  return {allowed:!!await waitForStableReceipt(()=>operation('card_receipt'),accept,{signal,minimumMs:1000}),persistenceChecked:true};
 },options);
}

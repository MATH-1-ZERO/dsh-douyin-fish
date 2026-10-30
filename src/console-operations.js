import {videoPreferences,validateVideoPreferences,videoRecipient} from './video-preferences.js';
import {prepareDedicatedBrowser} from './browser-control.js';
import {retainedBrowserStatus} from './retained-browser.js';
import {scanConversations} from './conversation-browser.js';
import {visitOwnerConversation} from './owner-dm.js';
import {currentConversationExpression} from './browser/conversations-ui.mjs';
import {replySettings,settingsPatch,digest} from './conversation-state.js';
import {updatedPersona} from './owner-settings.js';
import {effectiveSettings} from './persona.js';
import {reserveBrowserWorkflow} from './browser-workflow.js';

export class ConsoleOperations{
 constructor({store,loadBase,replies,worker,stopAll,io={}}){Object.assign(this,{store,loadBase,replies,worker,stopAll});this.io={prepareDedicatedBrowser,retainedBrowserStatus,scanConversations,visitOwnerConversation,...io};this.browser={liveChecked:false,bindingVerified:false};this.pending=null;this.controller=null;}
 get busy(){return !!(this.pending||this.pausing);}
 run(fn){if(this.busy)return Promise.resolve({allowed:false,reason:'console_operation_in_progress'});this.controller=new AbortController();const signal=this.controller.signal;this.pending=(async()=>{try{return await fn(signal);}catch(e){return {allowed:false,reason:signal.aborted?'console_operation_cancelled':String(e.message).slice(0,200)};}})().finally(()=>{this.pending=null;this.controller=null;});return this.pending;}
 pause(){if(this.pausing)return this.pausing;this.controller?.abort();this.pausing=(async()=>{if(this.pending)await this.pending;return this.stopAll();})().finally(()=>{this.pausing=null;});return this.pausing;}
 commands(){return {
  check_browser:()=>this.run(async()=>{this.browser=await this.io.retainedBrowserStatus();return {allowed:true,browser:this.browser};}),
  open_browser:()=>this.run(async signal=>{await this.stopAll();signal.throwIfAborted();const r=await this.io.prepareDedicatedBrowser({signal});this.browser=r.browser??{bindingVerified:false,liveChecked:true,reason:r.reason};return r;}),
  scan_conversations:()=>this.run(async signal=>{
   await this.stopAll();signal.throwIfAborted();const opened=await this.io.prepareDedicatedBrowser({signal});if(!opened.allowed)return opened;this.browser=opened.browser;
   const state=await this.store.snapshot(),settings=effectiveSettings(await this.loadBase(),state);
   const reserved=await reserveBrowserWorkflow(settings,this.store,{stages:2});if(!reserved.allowed)return reserved;const browserWorkflow=reserved.ticket;
   const found=await this.io.scanConversations({store:this.store,signal,settings,browserWorkflow});
   const proof=await this.io.visitOwnerConversation(settings,{confirm:'visit_verified_owner_conversation'},{store:this.store,signal,browserWorkflow},async({evaluate})=>({identity:await evaluate(currentConversationExpression)}));
   const identity=proof.report?.result?.identity;
   const candidate=proof.allowed&&identity?digest([identity.account,identity.name,identity.avatar]):null;
   const ownerId=found.items.some(x=>x.id===candidate)?candidate:null;
   signal.throwIfAborted();await this.store.transact(s=>{signal.throwIfAborted();s.resources.conversations={at:Date.now(),items:found.items,ownerId,loadedOnly:true};return {state:s,value:null};});
   return {allowed:true,count:found.items.length,ownerMatched:!!ownerId,...(!ownerId?{ownerMatchReason:proof.report?.error??proof.reason??'owner_not_in_loaded_conversations'}:{}),loadedOnly:true,sendingPerformed:false};
  }),
  save_replies:({changes})=>this.run(async signal=>{settingsPatch(await this.store.snapshot(),changes);const base=await this.loadBase();await this.stopAll();signal.throwIfAborted();return this.store.transact(s=>{signal.throwIfAborted();s.resources.replySettings=settingsPatch(s,changes);return {state:s,value:{allowed:true,settings:replySettings(s),paused:true}};});}),
  save_persona:({changes})=>this.run(async signal=>{const allowed=['name','personaText','voice','ownerAddress','likedTags','blockedTags'];if(!changes||!Object.keys(changes).length||Object.keys(changes).some(k=>!allowed.includes(k)))throw Error('invalid_persona_settings');const base=await this.loadBase();updatedPersona(base,await this.store.snapshot(),changes);await this.stopAll();signal.throwIfAborted();return this.store.transact(s=>{signal.throwIfAborted();s.resources.persona=updatedPersona(base,s,changes);return {state:s,value:{allowed:true,paused:true}};});}),
  save_video:({changes})=>this.run(async signal=>{
   const keys=['shareEnabled','commentEnabled','shareRecipient','commentStyle','likedTags','blockedTags','cycleIntervalSeconds','dwellMinSeconds','dwellMaxSeconds'];
   if(!changes||Object.keys(changes).some(k=>!keys.includes(k)))throw Error('invalid_video_preferences');
   const base=await this.loadBase(),patch=s=>{
    const p=validateVideoPreferences({...videoPreferences(s),...Object.fromEntries(Object.entries(changes).filter(([k])=>['shareEnabled','commentEnabled','shareRecipient','commentStyle'].includes(k)))});
    const personaChanges={...Object.fromEntries(Object.entries(changes).filter(([k])=>['likedTags','blockedTags'].includes(k))),watch:Object.fromEntries(Object.entries(changes).filter(([k])=>['cycleIntervalSeconds','dwellMinSeconds','dwellMaxSeconds'].includes(k)))};
    const persona=updatedPersona(base,s,personaChanges),copy=structuredClone(s);copy.resources.videoPreferences=p;copy.resources.persona=persona;
    if(p.shareEnabled&&!videoRecipient(copy))throw Error('video_recipient_required');
    if((p.shareEnabled||p.commentEnabled)&&!persona.likedTags.length)throw Error('video_interests_required');
    return {p,persona};
   };
   patch(await this.store.snapshot());await this.stopAll();signal.throwIfAborted();return this.store.transact(s=>{signal.throwIfAborted();const {p,persona}=patch(s);s.resources.videoPreferences=p;s.resources.persona=persona;return {state:s,value:{allowed:true,paused:true}};});
  }),
  start_plugin:({mode})=>this.run(async signal=>{await this.stopAll();signal.throwIfAborted();const r=await this.io.prepareDedicatedBrowser({signal});if(!r.allowed)return r;this.browser=r.browser;signal.throwIfAborted();const p=videoPreferences(await this.store.snapshot()),videoMode=mode==='videos'&&(p.shareEnabled||p.commentEnabled)?'console_preferences':'watch_only';const started=['watch_only','videos'].includes(mode)?await this.worker.start(videoMode==='watch_only'?'start_watch_only':'start_browse_and_deliver',videoMode):await this.replies.start();if(signal.aborted){await this.stopAll();return {allowed:false,reason:'console_operation_cancelled'};}return started;}),
  pause:()=>this.pause(),
 };}
}

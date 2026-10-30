import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshState,validateState,transition} from '../../src/engine.js';
import {importPersona,effectiveSettings} from '../../src/persona.js';
import {updatedPersona,ownerSettingsView} from '../../src/owner-settings.js';
import {reserveBrowserRead} from '../../src/manual-browser.js';
import {incomingCommand} from '../../src/incoming.js';
import {admission,freshAutonomy} from '../../src/autonomy.js';
import {JsonStore} from '../../src/store.js';
const base=JSON.parse(await readFile(new URL('../../config/default-settings.json',import.meta.url),'utf8'));
const persona=JSON.parse(await readFile(new URL('../../personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
const T=Date.UTC(2026,9,24,4);
function setup(changes={}){const s=freshState();importPersona(s,{...persona,ownerId:'owner',dmContacts:['friend']});s.resources.persona=updatedPersona(base,s,changes&&Object.keys(changes).length?changes:{dailyReads:3});return s;}
function patch(s,changes){s.resources.persona=updatedPersona(base,s,changes);return effectiveSettings(base,s);}
const message=(senderId='friend',messageId='m1')=>({kind:'dm',senderId,messageId,text:'今天的米饭香不香？'+messageId});
test('owner patches preserve every receipt and draft and expose effective settings',()=>{
 const s=setup();s.resources.manualBrowserReads=[T-1200000];const before=JSON.stringify(s.resources.manualBrowserReads);
 const c=patch(s,{dailyReads:7,readIntervalMinutes:30,maxCharacters:50,dmDailyLimitPerContact:2});
 assert.equal(c.manualBrowser.readsPer24Hours,7);assert.equal(c.manualBrowser.intervalMinutes,30);
 assert.equal(c.manualDrafts.maxCharacters,50);assert.equal(ownerSettingsView(base,s).limits.dmDailyLimitPerContact,2);
 assert.equal(JSON.stringify(s.resources.manualBrowserReads),before);assert.equal(s.paused,true);validateState(s);
});
test('reject invalid keys, types and extreme settings without changing persona',()=>{
 const s=setup(),before=JSON.stringify(s);
 for(const changes of [{dailyReads:101},{readIntervalMinutes:0},{strangers:'allow_all'},{allowOwnerDm:'yes'},{activeStart:'25:00'},{scheduleEnabled:'false'},{scheduleEnabled:null},{sendingSupported:true},{maxLines:3},{}])assert.throws(()=>updatedPersona(base,s,changes));
 assert.equal(JSON.stringify(s),before);
});

test('schedule setting preserves original values and exposes a backward-compatible explicit switch',()=>{
 const s=setup();delete s.resources.persona.schedule.enabled;const original=structuredClone(s.resources.persona.schedule);
 assert.equal(effectiveSettings(base,s).scheduleEnabled,true);assert.equal(ownerSettingsView(base,s).settings.scheduleEnabled,true);
 patch(s,{scheduleEnabled:false});assert.deepEqual(s.resources.persona.schedule,{...original,enabled:false});
 assert.equal(effectiveSettings(base,s).scheduleEnabled,false);assert.equal(ownerSettingsView(base,s).settings.scheduleEnabled,false);
 const restored=JSON.parse(JSON.stringify(s));validateState(restored);assert.equal(effectiveSettings(base,restored).scheduleEnabled,false);
 patch(s,{scheduleEnabled:true});assert.deepEqual(s.resources.persona.schedule,{...original,enabled:true});
});

test('registered settings update persists schedule disable and pauses both workers without erasing usage',async t=>{
 let state=setup();state.paused=false;state.resources.autonomy={...freshAutonomy(),enabled:true};
 const {freshOwnerReplies}=await import('../../src/owner-reply-state.js');
 state.resources.ownerReplies={...freshOwnerReplies(),enabled:true};state.resources.manualBrowserReads=[T-60000];
 t.mock.method(JsonStore.prototype,'snapshot',async()=>structuredClone(state));
 t.mock.method(JsonStore.prototype,'transact',async fn=>{const r=await fn(structuredClone(state));validateState(r.state);state=r.state;return r.value;});
 const tools=new Map(),{apply}=await import('../../src/index.js');apply({tools:{register:tool=>tools.set(tool.name,tool)}});
 const tool=tools.get('fish_settings_update');assert.equal(tool.parameters.properties.changes.properties.scheduleEnabled.type,'boolean');
 const result=await tool.execute({confirm:'update_owner_settings',changes:{scheduleEnabled:false}});
 assert.equal(result.allowed,true);assert.equal(result.automaticTasksPaused,true);assert.equal(result.settings.scheduleEnabled,false);
 assert.equal(state.paused,true);assert.equal(state.resources.autonomy.enabled,false);assert.equal(state.resources.ownerReplies.enabled,false);
 assert.deepEqual(state.resources.manualBrowserReads,[T-60000]);assert.equal(state.resources.requests.length,0);
});
test('zero daily reading limit stops admission and reservation',()=>{
 const s=setup({dailyReads:0});s.paused=false;s.resources.autonomy={...freshAutonomy(),enabled:true};
 assert.equal(admission(base,s,T).reason,'browser_disabled_by_owner_limit');
 assert.equal(reserveBrowserRead(effectiveSettings(base,s),s,T).value.reason,'browser_disabled_by_owner_limit');
 assert.equal(s.resources.manualBrowserReads,undefined);
});
test('lowering or raising reading quota never erases use or cooldown',()=>{
 const s=setup();s.resources.manualBrowserReads=[T-1800000,T-900000,T-60000];
 assert.equal(reserveBrowserRead(patch(s,{dailyReads:2}),s,T).value.reason,'manual_browser_daily_limit');
 assert.equal(reserveBrowserRead(patch(s,{dailyReads:7}),s,T).value.reason,'manual_browser_cooldown');
 assert.equal(s.resources.manualBrowserReads.length,3);
 const result=reserveBrowserRead(effectiveSettings(base,s),s,T+900000);assert.equal(result.value.readReservationsUsed,4);validateState(s);
});
test('draft daily cap applies before model reservation and does not refund existing work',()=>{
 let s=setup({draftDailyLimit:1});let c=effectiveSettings(base,s);
 let r=transition(c,s,'manual_prepare',{kind:'comment',material:'猫在窗台看雨'},T);assert.equal(r.value.allowed,true);s=r.state;
 r=transition(c,s,'manual_prepare',{kind:'comment',material:'狗在门口看雪'},T+1);assert.equal(r.value.reason,'owner_draft_daily_limit');assert.equal(r.state.resources.requests.length,1);
 c=patch(s,{draftDailyLimit:0});assert.equal(transition(c,s,'manual_prepare',{kind:'comment',material:'新内容'},T+2).value.reason,'owner_draft_daily_limit');
});
test('draft cooldown and custom model output limit are enforced',()=>{
 let s=setup({draftIntervalSeconds:600,maxOutputTokens:64});const c=effectiveSettings(base,s);
 let r=transition(c,s,'manual_prepare',{kind:'comment',material:'猫看雨'},T);assert.equal(r.value.maxOutputTokens,64);s=r.state;
 assert.equal(transition(c,s,'manual_prepare',{kind:'comment',material:'狗看雪'},T+1).value.reason,'owner_draft_cooldown');
 s.paused=false;s.resources.autonomy={...freshAutonomy(),enabled:true};assert.equal(admission(base,s,T+1).reason,'owner_draft_cooldown');
});
test('owner and contact switches stop DM draft preparation',()=>{
 for(const [field,sender,reason]of [['allowOwnerDm','owner','owner_dm_disabled'],['allowContactsDm','friend','contact_dm_disabled']]){
 const r=incomingCommand(base,setup({[field]:false}),'incoming_prepare',message(sender),T);assert.equal(r.value.reason,reason);assert.equal(r.state.resources.requests.length,0);}
});
test('ignore strangers stores no preview and makes no model request',()=>{
 const r=incomingCommand(base,setup({strangers:'ignore'}),'incoming_prepare',message('stranger'),T);
 assert.equal(r.value.reason,'stranger_ignored');assert.equal(r.state.resources.contactRequests.length,0);assert.equal(r.state.resources.requests.length,0);
});
test('per-contact cooldown and cap persist and do not block another contact',()=>{
 let s=setup({dmDailyLimitPerContact:2,dmIntervalSeconds:60});let r=incomingCommand(base,s,'incoming_prepare',message(),T);assert.equal(r.value.allowed,true);s=r.state;
 assert.equal(incomingCommand(base,s,'incoming_prepare',message('friend','m2'),T+1).value.reason,'contact_cooldown');
 r=incomingCommand(base,s,'incoming_prepare',message('owner'),T+2);assert.equal(r.value.allowed,true);s=r.state;
 r=incomingCommand(base,s,'incoming_prepare',message('friend','m2'),T+60000);assert.equal(r.value.allowed,true);s=r.state;
 assert.equal(incomingCommand(base,s,'incoming_prepare',message('friend','m3'),T+120000).value.reason,'contact_daily_limit');
 validateState(s);assert.ok(!JSON.stringify(s.resources.incomingReservations).includes('米饭'));
});
test('custom line limit is checked before draft storage',()=>{
 let s=setup({maxLines:1});const c=effectiveSettings(base,s),r=transition(c,s,'manual_prepare',{kind:'comment',material:'猫看雨'},T);
 assert.equal(transition(c,r.state,'manual_finish',{requestId:r.value.requestId,text:'猫在看雨\n鱼在看猫'},T+1).value.allowed,false);
});
test('owner can customize interaction limits without enabling a sender or erasing reading history',()=>{
 const s=setup();s.resources.manualBrowserReads=[T-60000];
 patch(s,{interactionLimits:{dailyLimit:3,intervalSeconds:1200,likeDailyLimit:0}});
 const view=ownerSettingsView(base,s);assert.equal(view.interactionLimits.dailyLimit,3);assert.equal(view.interactionLimits.likeDailyLimit,0);assert.equal(view.sendingSupported,true);assert.equal(view.sendingScope,'explicit_exact_public_actions_and_verified_owner_dm');assert.equal(view.automaticSendingEnabled,false);assert.equal(view.interactionAdapterConnected,true);assert.equal(s.resources.manualBrowserReads.length,1);
 assert.throws(()=>updatedPersona(base,s,{interactionLimits:{enabled:true}}));validateState(s);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {freshState,validateState,transition,browserRunStatus} from '../../src/engine.js';
import {JsonStore} from '../../src/store.js';
import {validatePersona,effectiveSettings,importPersona} from '../../src/persona.js';
import {admission,FishAutonomy,freshAutonomy} from '../../src/autonomy.js';
import {reserveBrowserRead} from '../../src/manual-browser.js';
import {createDraftGenerator} from '../../src/agent-bridge.js';
import {freshOwnerReplies} from '../../src/owner-reply-state.js';
import {ownerReplyDecision} from '../../src/owner-replies.js';
const base=JSON.parse(await readFile(new URL('../../config/default-settings.json',import.meta.url),'utf8'));
const profile=JSON.parse(await readFile(new URL('../../personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
// Explicit scheduling fixture; the distributable defaults to schedule disabled.
profile.schedule.enabled=true;
const T=Date.parse('2026-10-24T11:00:00+08:00');
function running(){const s=freshState();importPersona(s,profile);s.paused=false;s.resources.autonomy={...freshAutonomy(),enabled:true};return s;}
async function store(s=running()){const root=resolve('work/autonomy-tests');await mkdir(root,{recursive:true});const result=new JsonStore(await mkdtemp(join(root,'case-')));await result.transact(()=>({state:s,value:null}));return result;}
test('persona is typed data, not a source of permissions or tools',()=>{validatePersona(profile);const s=freshState();const r=importPersona(s,profile);const c=effectiveSettings(base,s);assert.equal(r.value.automaticTasksPaused,true);assert.ok(c.manualDrafts.persona.includes('鲸鱼娘'));assert.equal(c.enabled,false);assert.ok(Object.values(c.rules).every(v=>!v.enabled));assert.equal(c.personaText,undefined);assert.throws(()=>validatePersona({...profile,tools:['send_dm']}));assert.throws(()=>validatePersona({...profile,schedule:{...profile.schedule,dailyReads:999}}));});
test('persona import preserves quotas and pauses autonomy',()=>{const s=running();s.resources.manualBrowserReads=[T];s.resources.requests=[];importPersona(s,profile);assert.equal(s.resources.manualBrowserReads.length,1);assert.equal(s.resources.autonomy.enabled,false);assert.equal(s.paused,true);validateState(s);});
test('imported persona enforces two lines and catches explicit claims of seeing unobserved media',()=>{const s=running(),c=effectiveSettings(base,s);const r=transition(c,s,'manual_prepare',{kind:'comment',material:'小鲸鱼吃饭'},T);for(const [text,reason] of [['第一行\n第二行\n第三行','persona_reply_too_many_lines'],['我刚看完了视频，太好看啦。','unsupported_media_experience_claim']])assert.equal(transition(c,r.state,'manual_finish',{requestId:r.value.requestId,text},T+1).value.reason,reason);});
test('schedule respects daytime, overnight activity, rest and clock rollback',()=>{assert.equal(admission(base,running(),T).allowed,true);assert.equal(admission(base,running(),Date.parse('2026-10-24T23:00:00+08:00')).reason,'sleeping');const s=running();s.resources.autonomy.sessionStart=T-15*60000;assert.equal(admission(base,s,T).reason,'resting');const overnight=running();overnight.resources.persona.schedule.activeStart='23:00';overnight.resources.persona.schedule.activeEnd='01:00';assert.equal(admission(base,overnight,Date.parse('2026-10-25T00:30:00+08:00')).allowed,true);s.lastTime=T+1;assert.equal(admission(base,s,T).reason,'clock_rollback');});

test('schedule switch bypasses hours and both time and video session rests, then restores them when enabled',()=>{
 const night=Date.parse('2026-10-24T23:00:00+08:00');
 for(const [time,change,reason] of [
  [night,()=>{},'sleeping'],
  [T,a=>{a.restUntil=T+60000;},'resting'],
  [T,a=>{a.sessionStart=T-15*60000;},'resting'],
  [T,a=>{a.sessionStart=T-1000;a.videosThisSession=20;},'resting'],
 ]){
  const s=running();change(s.resources.autonomy);s.resources.persona.schedule.enabled=false;
  const schedule=structuredClone(s.resources.persona.schedule),runtime=structuredClone(s.resources.autonomy);
  assert.equal(admission(base,s,time).allowed,true);assert.deepEqual(s.resources.persona.schedule,schedule);
  assert.deepEqual(s.resources.autonomy,runtime);
  s.resources.persona.schedule.enabled=true;assert.equal(admission(base,s,time).reason,reason);
 }
 const disabled=running();disabled.resources.persona.schedule.enabled=false;disabled.paused=true;
 assert.equal(admission(base,disabled,night).reason,'autonomy_paused');
});

test('owner reply admission uses the persistent schedule switch without requiring a one-test exception',()=>{
 const s=running(),owner='verified_owner_123',night=Date.parse('2026-10-24T23:00:00+08:00');
 s.resources.autonomy.enabled=false;s.resources.persona.ownerId=owner;s.resources.persona.schedule.enabled=false;
 s.resources.ownerIdentity={verified:true,platformId:owner,ownerHandle:'owner_handle'};
 s.resources.ownerReplies={...freshOwnerReplies(),enabled:true,ownerId:owner,sessionStart:night-15*60000,restUntil:night+60000};
 assert.equal(ownerReplyDecision(base,s,night).allowed,true);
 s.resources.persona.schedule.enabled=true;assert.equal(ownerReplyDecision(base,s,night).reason,'sleeping');
 s.resources.persona.schedule.enabled=false;s.resources.ownerIdentity.verified=false;
 assert.equal(ownerReplyDecision(base,s,night).reason,'verified_owner_required');
});

test('legacy engine and in-flight browser recheck honor disabled schedule while retaining pause and original hours',()=>{
 const c=structuredClone(base);c.enabled=true;c.rules.browse.enabled=true;
 const night=Date.parse('2026-10-24T23:00:00+08:00'),s=running();
 s.resources.persona.schedule.enabled=false;s.sessionStart=night-15*60000;s.restUntil=night+60000;
 assert.equal(browserRunStatus(c,s,night).allowed,true);
 const tick=transition(c,s,'tick',{},night);assert.equal(tick.value.allowed,true);
 assert.equal(transition(c,s,'status',{},night).value.scheduleEnabled,false);
 assert.equal(transition(c,s,'context',{},night).value.context.policy.scheduleEnabled,false);
 s.resources.persona.schedule.enabled=true;assert.equal(browserRunStatus(c,s,night).reason,'sleeping');
 delete s.resources.persona;c.scheduleEnabled=false;assert.equal(browserRunStatus(c,s,night).allowed,true);
 s.paused=true;assert.equal(browserRunStatus(c,s,night).reason,'paused_or_disabled');
 assert.throws(()=>browserRunStatus({...c,scheduleEnabled:'no'},s,night),/schedule enabled/);
});
test('shared read limits, pending leases and pause block autonomous work',()=>{const s=running();s.resources.manualBrowserReads=[T-3000000,T-2000000,T-1000000];assert.equal(admission(base,s,T).reason,'manual_browser_daily_limit');s.resources.manualBrowserReads=[T-1];assert.equal(admission(base,s,T).reason,'manual_browser_cooldown');s.resources.manualBrowserReads=[];s.resources.autonomy.inFlightId='12345678-1234-1234-1234-123456789abc';assert.equal(admission(base,s,T).reason,'autonomy_busy_or_stale_lease');s.paused=true;assert.equal(admission(base,s,T).reason,'autonomy_paused');});
function fixture(s){let reads=0,models=0;const make=async()=>{const db=await store(s);const worker=new FishAutonomy({store:db,loadBase:async()=>base,now:()=>T,
 read:async(settings,args,{store})=>{reads++;const q=await store.transact(state=>reserveBrowserRead(settings,state,T));return q.allowed?{allowed:true,untrustedMaterial:{text:'小鲸鱼吃白米饭',sourceRef:'https://www.douyin.com/jingxuan?modal_id=1234567890123456789'}}:q;},
 generate:async(prepared,{commit})=>{models++;const r=await commit('鱼片，米饭先给我留一口嘛。🐳');return {allowed:r.allowed,status:r.allowed?'draft_saved':'rejected'};},setTimer:()=>({unref(){}}),clearTimer:()=>{}});return {db,worker,get reads(){return reads;},get models(){return models;}};};return make();}
test('autonomous cycle reads, reserves and saves one draft, then clears lease',async()=>{const f=await fixture();const r=await f.worker.tick();assert.equal(r.allowed,true);const s=await f.db.snapshot();assert.equal(s.resources.manualDrafts.length,1);assert.equal(s.resources.manualDrafts[0].status,'copy_only_unsent');assert.equal(s.resources.manualBrowserReads.length,1);assert.equal(s.resources.requests.length,1);assert.equal(s.resources.autonomy.inFlightId,null);assert.equal(f.models,1);});
test('blocked preferences skip generation while retaining the browser reservation',async()=>{const s=running();s.resources.persona.blockedTags=['米饭'];const f=await fixture(s);assert.equal((await f.worker.tick()).reason,'blocked_preference');assert.equal(f.models,0);assert.equal((await f.db.snapshot()).resources.manualBrowserReads.length,1);});
test('exhausted allowance does not open browser or call model',async()=>{const s=running();s.resources.manualBrowserReads=[T-3000000,T-2000000,T-1000000];const f=await fixture(s);assert.equal((await f.worker.tick()).reason,'manual_browser_daily_limit');assert.equal(f.reads,0);assert.equal(f.models,0);});
test('start requires explicit instruction and actual model runtime; stop prevents further work',async()=>{const f=await fixture();assert.equal((await f.worker.start('wrong')).allowed,false);f.worker.generate=null;assert.equal((await f.worker.start('start_browse_and_drafts')).reason,'DSH_agent_runtime_unavailable');await f.worker.stop();assert.equal((await f.worker.tick()).reason,'autonomy_paused');assert.equal(f.reads,0);});
test('read-only snapshot never recreates initialized missing state',async()=>{const root=resolve('work/autonomy-tests');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'missing-'));const db=new JsonStore(directory);assert.equal((await db.snapshot()).paused,true);const {writeFile}=await import('node:fs/promises');await writeFile(join(directory,'initialized'),'1');await assert.rejects(db.snapshot(),/STATE_MISSING/);});
test('DSH bridge hides global tools, enforces request count and allows only one scoped save',async()=>{const events={},registered=[],restrictions=[];let disposed=0,commits=0;const ctx={agents:{async create(options){options.setup({tools:{restrict:f=>restrictions.push(f),register:t=>registered.push(t)},on:(name,fn)=>{events[name]=fn;}},{id:options.sessionId,session:{id:options.sessionId}});return {agent:{id:options.sessionId,session:{id:options.sessionId},followup(){},cancel(){},async whenIdle(){events['agent/request']({},()=>({provider:'deepseek-account',model:'deepseek-flash'}));await registered[0].execute({text:'鱼片，米饭分我一口嘛。'});await assert.rejects(registered[0].execute({text:'重复'}));assert.throws(()=>events['agent/request'](),/budget/);}},dispose:async()=>{disposed++;}};}},agentDefaultModel:{currentSelection:()=>({provider:'deepseek-account',model:'deepseek-flash'})}};const generate=createDraftGenerator(ctx);const result=await generate({payload:{},writingRules:{},maxOutputTokens:160},{commit:async()=>{commits++;return {allowed:true,draft:{id:'draft-1'}};}});assert.equal(result.allowed,true);assert.deepEqual(restrictions,[{allow:[]}]);assert.equal(registered.length,1);assert.equal(commits,1);assert.equal(disposed,1);});

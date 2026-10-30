import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,win32} from 'node:path';
import {bindOwner,ownerBindingInput} from './owner-binding.js';
import {windowsPaths} from './windows-paths.js';
import {JsonStore} from './store.js';
import {importPersona,effectiveSettings} from './persona.js';
const base=JSON.parse(await readFile(new URL('./settings.json',import.meta.url),'utf8'));
const persona=JSON.parse(await readFile(new URL('./personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
const args={confirm:'bind_owner_from_public_profile',sourceRef:'https://www.douyin.com/user/synthetic_owner_123',ownerHandle:'test_owner'};
async function fixture(){
 const store=new JsonStore(await mkdtemp(join(tmpdir(),'fish-owner-binding-')));
 await store.transact(s=>importPersona(s,persona));
 let reads=0,fail=false;
 const deps={store,loadLease:async()=>({verify:async()=>({})}),delay:async()=>{},
  profileRunner:async(_url,callback)=>{try{return {success:true,result:await callback({signal:undefined})};}catch(e){return {success:false,error:e.message};}},
  withUiPage:async(_url,callback)=>callback({session:{send:async(method)=>{assert.equal(method,'Runtime.evaluate');reads++;return {result:{value:fail?{ready:false}:{ready:true,profileHandleVerified:true,ownerName:'测试主人',avatarResource:'/aweme-avatar/synthetic'}}};}},sessionId:'s',contextId:1})};
 return {store,deps,get reads(){return reads;},set fail(v){fail=v;},settings:effectiveSettings(base,await store.snapshot())};
}
test('portable Windows paths include per-user Edge and respect non-C system directories',()=>{
 const p=windowsPaths({SystemRoot:'X:\\Windows',ProgramFiles:'Y:\\Apps',LOCALAPPDATA:'Z:\\用户 空间\\Local'});
 assert.equal(p.powershell,win32.join('X:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'));
 assert.ok(p.edgeCandidates.includes(win32.join('Z:\\用户 空间\\Local','Microsoft','Edge','Application','msedge.exe')));
});
test('public owner binding refuses missing confirmation, non-profile URLs and injected handles',()=>{
 for(const patch of [{confirm:''},{sourceRef:'https://evil.test/user/synthetic_owner_123'},{sourceRef:args.sourceRef+'?x=y'},{ownerHandle:'test owner'},{sourceRef:'https://www.douyin.com/user/self'}])assert.throws(()=>ownerBindingInput({...args,...patch}));
});
test('fresh installation imports generic persona then binds a real-read identity without enabling sends',async()=>{
 const f=await fixture();assert.equal((await f.store.snapshot()).resources.persona.schedule.enabled,false);
 assert.equal((await f.store.snapshot()).resources.persona.ownerId,'');
 const r=await bindOwner(f.settings,args,f.deps);assert.equal(r.allowed,true);assert.equal(f.reads,2);
 const s=await f.store.snapshot();assert.equal(s.resources.ownerIdentity.platformId,'synthetic_owner_123');assert.equal(s.resources.persona.ownerId,'synthetic_owner_123');assert.equal(s.paused,true);assert.equal(s.resources.requests.length,0);assert.equal(s.resources.manualDrafts.length,0);assert.equal(s.resources.interactionAttempts?.length??0,0);
});
test('mismatched live profile cannot create a verified identity',async()=>{
 const f=await fixture();f.fail=true;const r=await bindOwner(f.settings,args,f.deps);assert.equal(r.allowed,false);assert.equal((await f.store.snapshot()).resources.ownerIdentity,undefined);
});
test('another existing owner and running tasks cannot be overwritten by setup',async()=>{
 const f=await fixture();await f.store.transact(s=>{s.resources.ownerIdentity={verified:true,platformId:'different_123',ownerHandle:'different'};return {state:s,value:null};});
 assert.equal((await bindOwner(f.settings,args,f.deps)).reason,'different_owner_already_bound');assert.equal(f.reads,0);
 await f.store.transact(s=>{s.paused=false;return {state:s,value:null};});assert.equal((await bindOwner(f.settings,args,f.deps)).reason,'pause_before_owner_binding');
});

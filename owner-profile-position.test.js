import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ownerProfilePositionExpression} from './live-browser/owner-profile-position.mjs';

const profile='https://www.douyin.com/user/verified_owner_123';
const fieldsSelector='[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""],textarea,input';
function fixture(){
 const calls=[],fields=[],dialogs=[],labels=[];
 const element=()=>({tagName:'DIV',children:[],hidden:false,offscreen:false,opacity:'1',
  getBoundingClientRect(){return {width:500,height:600,left:72,right:572,top:this.offscreen?-700:0,bottom:this.offscreen?-100:600};},
  getAttribute(){return null;},closest(){return null;},
 });
 const container={...element(),scrollTop:1112,scrollTo(options){calls.push({...options});this.scrollTop=options.top;}};
 const containers=[container];
 const document={visibilityState:'visible',querySelectorAll(selector){
  if(selector==='[role="dialog"]')return dialogs;
  if(selector==='h1,h2,h3,[role="heading"],span,p,div')return labels;
  if(selector===fieldsSelector)return fields;
  if(selector==='.parent-route-container.route-scroll-container')return containers;
  assert.fail('Unexpected selector: '+selector);
 }};
 const context={URL,document,location:{href:profile,assign(){assert.fail('Must not navigate');},reload(){assert.fail('Must not reload');}},innerWidth:1200,innerHeight:800,getComputedStyle:e=>({display:e.hidden?'none':'block',visibility:'visible',opacity:e.opacity})};
 return {element,container,containers,calls,fields,dialogs,labels,document,context,run(){return vm.runInNewContext(ownerProfilePositionExpression(profile),context);}};
}

test('profile positioning performs one instant scroll in its exact container without claiming identity',()=>{
 const f=fixture(),result=f.run();
 assert.equal(result.ready,true);assert.equal(result.scrollPerformed,true);assert.equal(result.profileIdentityVerified,false);
 assert.deepEqual(f.calls,[{top:0,behavior:'instant'}]);assert.equal(f.container.scrollTop,0);
 assert.equal(f.run().scrollPerformed,false);assert.equal(f.calls.length,1);
});

test('already positioned profile is accepted without any scroll',()=>{
 const f=fixture();f.container.scrollTop=0;
 const result=f.run();assert.equal(result.ready,true);assert.equal(result.scrollPerformed,false);assert.equal(f.calls.length,0);
});

test('changed profile route and hidden documents stop before reading page content or moving',()=>{
 for(const kind of ['route','hidden']){
  const f=fixture();if(kind==='route')f.context.location.href=profile+'?other=1';else f.document.visibilityState='hidden';
  f.document.querySelectorAll=()=>assert.fail('No page reads after route or visibility refusal');
  assert.equal(f.run().reason,kind==='route'?'owner_profile_changed':'owner_dm_page_hidden');assert.equal(f.calls.length,0);
 }
});

test('visible verification and login restrictions block positioning without fallback',()=>{
 for(const [text,reason] of [['请完成安全验证','manual_verification_required'],['扫码登录','manual_login_required']]){
  const f=fixture();f.labels.push({...f.element(),innerText:text});
  assert.equal(f.run().reason,reason);assert.equal(f.calls.length,0);
 }
 const f=fixture();f.dialogs.push({...f.element(),innerText:'安全验证'});
 assert.equal(f.run().reason,'manual_verification_required');assert.equal(f.calls.length,0);
});

test('any nonempty visible text input is preserved, and values are never returned',()=>{
 for(const type of ['text','search','textarea','editable']){
  const f=fixture(),field={...f.element(),tagName:type==='text'||type==='search'?'INPUT':type==='textarea'?'TEXTAREA':'DIV'};
  field.getAttribute=name=>name==='type'?type:null;
  if(field.tagName==='INPUT')field.value='保留输入';else field.innerText='保留输入';f.fields.push(field);
  const result=f.run();assert.equal(result.reason,'existing_input_preserved');assert.equal(f.calls.length,0);assert.equal(JSON.stringify(result).includes('保留输入'),false);
 }
});

test('hidden text and non-text input values are never inspected',()=>{
 const f=fixture(),hidden={...f.element(),hidden:true},checkbox={...f.element(),tagName:'INPUT',getAttribute:()=> 'checkbox'};
 for(const e of [hidden,checkbox])Object.defineProperty(e,'value',{get(){assert.fail('Hidden or non-text values must not be read');}});
 f.fields.push(hidden,checkbox,{...f.element(),innerText:'\u200B\uFEFF '});
 assert.equal(f.run().ready,true);assert.equal(f.calls.length,1);
});

test('missing, offscreen, transparent or ambiguous containers do not scroll the page',()=>{
 for(const kind of ['missing','offscreen','transparent','multiple']){
  const f=fixture();
  if(kind==='missing')f.containers.length=0;
  if(kind==='offscreen')f.container.offscreen=true;
  if(kind==='transparent')f.container.opacity='0';
  if(kind==='multiple')f.containers.push({...f.element(),scrollTop:0});
  assert.equal(f.run().reason,'owner_profile_scroll_container_ambiguous');assert.equal(f.calls.length,0);
 }
});

test('invalid positions and an ineffective scroll are refused without a second scroll',()=>{
 for(const scrollTop of [NaN,Infinity,-1]){
  const f=fixture();f.container.scrollTop=scrollTop;assert.equal(f.run().reason,'owner_profile_scroll_position_invalid');assert.equal(f.calls.length,0);
 }
 const f=fixture();f.container.scrollTo=options=>f.calls.push({...options});
 const result=f.run();assert.equal(result.reason,'owner_profile_scroll_not_applied');assert.equal(result.scrollPerformed,true);assert.equal(f.calls.length,1);
 const unsupported=fixture();unsupported.container.scrollTo=null;assert.equal(unsupported.run().reason,'owner_profile_scroll_not_supported');assert.equal(unsupported.calls.length,0);
});

test('only canonical public owner profile URLs can construct the expression',()=>{
 for(const value of ['https://evil.example/user/owner_123','https://www.douyin.com/user/owner_123?x=1','https://www.douyin.com/user/owner_123#fragment','https://www.douyin.com/jingxuan',null,{}])assert.throws(()=>ownerProfilePositionExpression(value),/Exact public owner profile/);
});

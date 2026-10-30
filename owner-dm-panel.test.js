import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ownerDmExpression} from './live-browser/owner-dm-ui.mjs';

const profile='https://www.douyin.com/user/verified_owner_123';
const scope={profile,ownerHandle:'owner_handle',ownerName:'主人'};
const fieldsSelector='[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""],textarea,input';
const editorsSelector='[contenteditable="true"],[contenteditable="plaintext-only"],textarea';
function fixture(){
 const elements=[];
 function element(tagName='DIV',classes='',attributes={}){
  const e={tagName,classes,attrs:{...attributes},children:[],parentElement:null,innerText:'',hidden:false,pointerEvents:'auto',
   getAttribute(name){return name==='class'?this.classes:this.attrs[name]??null;},
   hasAttribute(name){return Object.hasOwn(this.attrs,name);},
   getBoundingClientRect(){return {width:this.hidden?0:32,height:32,left:100,top:100,right:132,bottom:132};},
   contains(other){for(let at=other;at;at=at.parentElement)if(at===this)return true;return false;},
   matches(selector){
    return selector.split(',').some(s=>{
     s=s.trim();const tag=s.match(/^[A-Za-z]+/)?.[0];
     if(tag&&this.tagName.toLowerCase()!==tag.toLowerCase())return false;
     if([...s.matchAll(/\.([A-Za-z0-9_-]+)/g)].some(m=>!this.classes.split(' ').includes(m[1])))return false;
     return [...s.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([,name,value])=>value===undefined?this.hasAttribute(name):this.getAttribute(name)===value);
    });
   },
   closest(selector){for(let at=this;at;at=at.parentElement)if(at.matches(selector))return at;return null;},
   querySelectorAll(selector){return elements.filter(other=>other!==this&&this.contains(other)&&other.matches(selector));},
   click(){assert.fail('Expression must only produce a point');},
  };
  e.classList={contains:cls=>e.classes.split(' ').includes(cls)};
  elements.push(e);return e;
 }
 const append=(parent,child)=>{child.parentElement=parent;parent.children.push(child);return child;};
 const handle=element();handle.innerText='抖音号：'+scope.ownerHandle;
 const panel=element('DIV','StackLayoutpagespageRoot');
 const bar=append(panel,element('DIV','StackLayoutStackTitleBartitleBar'));
 const header=append(bar,element('DIV','StackLayoutStackChatHeadertitle'));header.innerText=scope.ownerName;
 const right=append(bar,element('DIV','StackLayoutStackTitleBarrightArea'));
 const close=append(right,element('svg','StackLayoutStackTitleBarcloseImPage'));
 const path=append(close,element('path'));
 const editor=append(panel,element('DIV','messageEditorinputArea',{contenteditable:'true'}));
 const list=append(panel,element('DIV','messageMessageListwrapper'));
 const message=append(list,element('DIV','',{ 'data-e2e':'msg-item-content'}));
 Object.defineProperty(message,'innerText',{get(){assert.fail('Panel transition must not read private messages');}});
 const open=element('BUTTON');open.innerText='私信';
 let hit=path,hitChecks=0;
 const document={visibilityState:'visible',
  querySelectorAll(selector){
   if(selector==='span,p,div,h1,h2,h3')return [handle,header,editor,message];
   if(selector==='h1,h2,h3,[role="heading"],span,p,div')return [handle,header,editor,message];
   if(selector==='[role="dialog"]')return elements.filter(e=>e.attrs.role==='dialog');
   if(selector==='button,[role="button"]')return [open];
   if(selector===fieldsSelector)return elements.filter(e=>e.matches('[contenteditable],textarea,input'));
   if(selector===editorsSelector)return elements.filter(e=>e.matches(editorsSelector));
   return elements.filter(e=>e.matches(selector));
  },
  elementFromPoint(){hitChecks++;return hit;},
 };
 const context={URL,location:{href:profile},document,innerWidth:1200,innerHeight:800,
  getComputedStyle:e=>({display:e.hidden?'none':'block',visibility:'visible',opacity:'1',pointerEvents:e.pointerEvents})};
 return {element,append,handle,panel,bar,header,right,close,path,editor,list,open,document,context,
  set hit(value){hit=value;},get hitChecks(){return hitChecks;},
  run(phase='point_close'){return vm.runInNewContext(ownerDmExpression({...scope,phase}),context);}};
}

test('an empty exact owner panel yields only its close point, accepting the SVG child hit',()=>{
 const f=fixture(),r=f.run();assert.equal(r.ready,true);assert.deepEqual({...r.point},{x:116,y:116});
 assert.equal(r.privateMessagesRead,false);assert.equal(f.hitChecks,1);
});

test('closed only succeeds after all visible headers, editors and message lists disappear',()=>{
 const f=fixture();assert.equal(f.run('closed').closed,false);assert.equal(f.hitChecks,0);
 for(const e of [f.header,f.editor,f.list])e.hidden=true;
 assert.equal(f.run('closed').closed,true);
 for(const e of [f.header,f.editor,f.list]){
  e.hidden=false;assert.equal(f.run('closed').closed,false);e.hidden=true;
 }
 assert.equal(f.hitChecks,0);
});

test('opening, closing and closure checks preserve nonempty private or unrelated text input',()=>{
 for(const phase of ['point_open','point_close','closed']){
  for(const kind of ['private','text','search','textarea','plaintext']){
   const f=fixture();let field=f.editor;
   if(kind==='text'||kind==='search'){field=f.element('INPUT','',{type:kind});field.value='保留输入';}
   else if(kind==='textarea')field=f.element('TEXTAREA');
   else if(kind==='plaintext')field=f.element('DIV','',{contenteditable:'plaintext-only'});
   if(kind!=='text'&&kind!=='search')field.innerText='保留输入';
   const r=f.run(phase);assert.equal(r.reason,'existing_input_preserved',phase+':'+kind);assert.equal(f.hitChecks,0);
   assert.equal(JSON.stringify(r).includes('保留输入'),false);
  }
 }
});

test('empty zero-width editor placeholders do not block closing and hidden text is not read',()=>{
 const f=fixture();f.editor.innerText='\u200B \uFEFF\n';
 const hidden=f.element('INPUT','',{type:'text'});hidden.hidden=true;
 Object.defineProperty(hidden,'value',{get(){assert.fail('Must not inspect hidden input');}});
 assert.equal(f.run().ready,true);
});

test('point_open retains its existing guard after the shared input check',()=>{
 const f=fixture();for(const e of [f.header,f.editor,f.list])e.hidden=true;
 f.hit=f.open;assert.equal(f.run('point_open').ready,true);
 f.hit=f.path;assert.equal(f.run('point_open').reason,'owner_dm_button_occluded');
});

test('a reopened header, editor or list blocks point_open before locating its button',()=>{
 for(const part of ['header','editor','list']){
  const f=fixture();for(const e of [f.header,f.editor,f.list])e.hidden=true;
  f[part].hidden=false;
  const query=f.document.querySelectorAll;
  f.document.querySelectorAll=selector=>{if(selector==='button,[role="button"]')assert.fail('Must not locate open while a panel is present');return query(selector);};
  assert.equal(f.run('point_open').reason,'owner_dm_panel_reopened_before_open');assert.equal(f.hitChecks,0);
 }
});

test('wrong profile, handle, owner conversation or hidden page cannot yield a close point',()=>{
 for(const [change,reason] of [
  [f=>{f.context.location.href='https://www.douyin.com/user/another_owner_123';},'profile_changed'],
  [f=>{f.handle.innerText='抖音号：somebody_else';},'owner_handle_not_verified'],
  [f=>{f.header.innerText='其他人';},'owner_dm_close_conversation_mismatch'],
  [f=>{f.document.visibilityState='hidden';},'owner_dm_page_hidden'],
 ]){
  const f=fixture();change(f);assert.equal(f.run().reason,reason);assert.equal(f.hitChecks,0);
 }
});

test('a visible verification dialog blocks each panel transition phase',()=>{
 for(const phase of ['point_close','closed','point_open']){
  const f=fixture();f.element('DIV','',{role:'dialog'}).innerText='请完成安全验证';
  assert.equal(f.run(phase).reason,'manual_verification_required');assert.equal(f.hitChecks,0);
 }
});

test('duplicate headers, editors, message lists or owner panels cannot be closed',()=>{
 for(const [tag,cls,attrs,reason] of [
  ['DIV','StackLayoutStackChatHeadertitle',{},'owner_dm_close_conversation_mismatch'],
  ['DIV','messageEditorinputArea',{contenteditable:'true'},'owner_dm_close_conversation_mismatch'],
  ['DIV','messageMessageListwrapper',{},'owner_dm_close_conversation_mismatch'],
  ['DIV','StackLayoutpagespageRoot',{},'owner_dm_close_panel_unbound'],
 ]){
  const f=fixture();f.element(tag,cls,attrs);assert.equal(f.run().reason,reason);assert.equal(f.hitChecks,0);
 }
});

test('a same-name header cannot bind an editor or list outside its panel',()=>{
 for(const part of ['editor','list']){
  const f=fixture();f[part].parentElement=null;assert.equal(f.run().reason,'owner_dm_close_panel_unbound');assert.equal(f.hitChecks,0);
 }
});

test('a covered contact-list layer in the same stack is accepted, but an exposed second layer is refused',()=>{
 for(const exposed of [false,true]){
  const f=fixture(),stack=f.element('DIV','StackLayoutStackLayoutV2wrapper');
  f.append(stack,f.panel);
  const lower=f.append(stack,f.element('DIV','StackLayoutpagespageRoot'));
  const otherClose=f.append(lower,f.element('svg','StackLayoutStackTitleBarcloseImPage'));
  if(exposed)f.hit=otherClose;
  const result=f.run();assert.equal(result.ready,!exposed);
  if(exposed)assert.equal(result.reason,'owner_dm_close_panel_unbound');
 }
});

test('missing, duplicated or misplaced close controls are refused without hit testing',()=>{
 for(const change of [
  f=>{f.close.hidden=true;},
  f=>{f.append(f.right,f.element('svg','StackLayoutStackTitleBarcloseImPage'));},
  f=>{f.close.parentElement=f.panel;},
  f=>{f.append(f.panel,f.element('DIV','StackLayoutStackTitleBartitleBar'));},
 ]){
  const f=fixture();change(f);assert.equal(f.run().reason,'owner_dm_close_control_ambiguous');assert.equal(f.hitChecks,0);
 }
});

test('disabled, inert or pointer-blocked close controls and ancestors are refused',()=>{
 for(const [part,change] of [
  ['close',e=>{e.attrs['aria-disabled']='true';}],
  ['close',e=>{e.attrs.disabled='';}],
  ['right',e=>{e.attrs.inert='';}],
  ['panel',e=>{e.pointerEvents='none';}],
 ]){
  const f=fixture();change(f[part]);assert.equal(f.run().reason,'owner_dm_close_control_disabled');assert.equal(f.hitChecks,0);
 }
});

test('an overlay or missing hit target blocks closing',()=>{
 for(const missing of [false,true]){
  const f=fixture();f.hit=missing?null:f.element();assert.equal(f.run().reason,'owner_dm_close_control_occluded');assert.equal(f.hitChecks,1);
 }
});

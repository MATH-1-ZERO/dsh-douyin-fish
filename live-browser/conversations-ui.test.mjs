import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {conversationsExpression,conversationImageKey,conversationIdentityCheck} from './conversations-ui.mjs';

test('conversation avatar identity survives trusted CDN and crop changes, rejects a different resource',()=>{
 const first='https://p11.douyinpic.com/img/aweme-avatar/tos-cn-i-0813_cat~c5_168x168.webp?signature=old';
 const next='https://p3.douyinpic.com/aweme/100x100/aweme-avatar/tos-cn-i-0813_cat.jpeg?signature=new';
 assert.equal(conversationImageKey(first),conversationImageKey(next));
 assert.notEqual(conversationImageKey(first),conversationImageKey(next.replace('_cat','_dog')));
 assert.notEqual(conversationImageKey(first),conversationImageKey(first.replace('p11.douyinpic.com','evil.test')));
 assert.equal(conversationImageKey('https://user:password@p3.douyinpic.com/aweme-avatar/cat'),null);
});

function fixture(){
 const box={left:10,top:10,right:30,bottom:30,width:20,height:20};
 const node=()=>({getBoundingClientRect:()=>box,getAttribute:()=>null,contains:e=>e===control,disabled:false});
 const panel=node(),control=node(),list=node(),account=node(),field=node();
 account.getAttribute=()=> 'https://p3.douyinpic.com/img/aweme-avatar/self~c5.webp';
 list.closest=()=>panel;panel.querySelectorAll=()=>[control];field.value='';
 const state={panels:[panel],hit:control,fields:[]};
 const document={visibilityState:'visible',elementFromPoint:()=>state.hit,querySelectorAll:selector=>{
  if(selector.startsWith('a[href='))return [account];
  if(selector.startsWith('[contenteditable'))return state.fields;
  if(selector==='.conversationConversationListwrapper')return [list];
  if(selector==='.StackLayoutpagespageRoot')return state.panels;
  return [];
 }};
 const expression=conversationsExpression({page:'https://www.douyin.com/user/example',phase:'close_list'});
 const run=()=>vm.runInNewContext(expression,{URL,location:{href:'https://www.douyin.com/user/example'},document,innerWidth:1000,innerHeight:800,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})});
 return {run,state,field};
}
test('contact list has a guarded close point before returning to owner profile',()=>{
 const f=fixture();assert.equal(f.run().ready,true);
 f.state.hit={};assert.equal(f.run().reason,'conversation_control_occluded');
});
test('contact list closing refuses a second visible panel or existing user input',()=>{
 const f=fixture();f.state.panels.push({...f.state.panels[0]});assert.equal(f.run().reason,'conversation_close_unbound');
 f.state.panels.pop();f.field.value='尚未发送';f.state.fields=[f.field];assert.equal(f.run().reason,'existing_input_preserved');
});
test('selected conversation header still binds nickname, avatar and current account after CDN changes',()=>{
 const box={left:1,top:1,right:10,bottom:10,width:9,height:9};
 const account={getBoundingClientRect:()=>box,getAttribute:()=> 'https://p3.douyinpic.com/img/aweme-avatar/self~c5.webp'};
 const avatar={getAttribute:()=> 'https://p11.douyinpic.com/img/aweme-avatar/friend~c5.webp'};
 const title={innerText:'朋友',getBoundingClientRect:()=>box};
 const header={getBoundingClientRect:()=>box,contains:x=>x===title,querySelectorAll:()=>[avatar]};
 const document={visibilityState:'visible',querySelectorAll:s=>s.startsWith('a[href=')?[account]:s==='.StackLayoutStackChatHeaderuser'?[header]:[title]};
 const input={name:'朋友',account:'https://douyinpic.com/aweme-avatar/self',avatar:'https://douyinpic.com/aweme-avatar/friend'};
 const run=()=>vm.runInNewContext(`(${conversationIdentityCheck.toString()})(input,${conversationImageKey.toString()})`,{URL,input,document,innerWidth:100,innerHeight:100,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})});
 assert.equal(run(),true);input.avatar='https://douyinpic.com/aweme-avatar/stranger';assert.equal(run(),false);input.avatar='https://douyinpic.com/aweme-avatar/friend';input.account='https://douyinpic.com/aweme-avatar/another';assert.equal(run(),false);
});

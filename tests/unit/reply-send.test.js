import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {interactionExpression} from '../../src/browser/interaction-expression.mjs';
import {commentFingerprint} from '../../src/comment-policy.js';
import {performReply} from '../../src/browser-actions.js';
const videoId='7551370789157637436',authorId='comment_author_123',sourceRef='https://www.douyin.com/video/'+videoId;
const binding={authorId,authorName:'网友甲',text:'小鱼好呀',localCommentKey:commentFingerprint(videoId,authorId,'小鱼好呀')};
function wrongLabelFixture(phase){
 const leaf=(extra={})=>({getBoundingClientRect:()=>({top:10,left:10,bottom:50,right:110,width:100,height:40}),...extra});
 let hits=0;const parent=leaf();
 const text=leaf({innerText:binding.text,closest:()=>parent});
 const author=leaf({innerText:binding.authorName,closest:()=>parent,getAttribute:()=>'/user/'+authorId});
 parent.querySelectorAll=s=>s==='.FduGc_lz'?[text]:s==='.comment-item-info-wrap a[href]'?[author]:[];
 parent.contains=()=>false;
 const editor=leaf({innerText:phase==='point_submit'?'这是回复文字':'',tagName:'DIV'});
 const box=leaf({querySelectorAll:()=>[editor],querySelector:()=>({innerText:'回复另一位网友'})});
 const video=leaf(),root=leaf({classList:{contains:()=>true},contains:()=>true,querySelector:()=>null,querySelectorAll:s=>s==='.comment-input-container'?[box]:s==='[data-e2e="comment-item"]'?[parent]:[]});
 const document={querySelectorAll:s=>s==='[data-e2e="feed-active-video"]'?[root]:s==='video'?[video]:[],elementFromPoint(){hits++;throw Error('Must not click');}};
 return {scope:{URL,location:{href:sourceRef},document,innerHeight:800,innerWidth:1000,getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'})},hits:()=>hits};
}
test('a mismatched reply composer cannot receive text or a submit click',()=>{
 for(const phase of ['point_submit','input_guard']){
  const f=wrongLabelFixture(phase);
  const result=vm.runInNewContext(interactionExpression({phase,videoId,text:'这是回复文字',replyBinding:binding}),f.scope);
  assert.equal(result.ready,false);assert.equal(result.reason,'unexpected_reply_target');assert.equal(f.hits(),0);
 }
});
test('reply fingerprints are recomputed rather than trusting caller-supplied identities',()=>{
 assert.throws(()=>interactionExpression({phase:'point_reply',videoId,replyBinding:{...binding,localCommentKey:'a'.repeat(64)}}),/exact reply binding/);
 assert.throws(()=>interactionExpression({phase:'point_reply',videoId}),/Exact reply binding/);
});
test('reply sender never falls back to an unbound ordinary comment',async()=>{
 assert.equal((await performReply({}, {},{})).reason,'explicit_bound_reply_required');
 const r=await performReply({}, {confirm:'publish_one_bound_reply',draftId:'old'},{store:{snapshot:async()=>({resources:{manualDrafts:[{id:'old',kind:'comment',status:'copy_only_unsent',text:'普通草稿'}]}})}});
 assert.equal(r.reason,'unsent_bound_comment_draft_required');
});

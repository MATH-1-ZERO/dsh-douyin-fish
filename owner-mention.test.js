import test from 'node:test';
import assert from 'node:assert/strict';
import {previewOwnerMention} from './owner-mention.js';
import {interactionExpression} from './live-browser/interaction-expression.mjs';
const sourceRef='https://www.douyin.com/video/7551370789157637436';
test('mention preview requires confirmation and verified stored owner before browser use',async()=>{
 assert.equal((await previewOwnerMention({}, {},{})).reason,'explicit_mention_preview_required');
 assert.equal((await previewOwnerMention({}, {confirm:'preview_owner_mention_without_sending',sourceRef},{store:{snapshot:async()=>({resources:{}})}})).reason,'verified_owner_required');
});
test('mention preview queries exact stored handle, clears its own input and never selects or sends',async()=>{
 let filled=false,cleared=false;const phases=[];
 const store={snapshot:async()=>({resources:{ownerIdentity:{verified:true,platformId:'owner_12345',ownerHandle:'dy_owner'},persona:{ownerId:'owner_12345'}}})};
 const r=await previewOwnerMention({}, {confirm:'preview_owner_mention_without_sending',sourceRef},{store,
 read:async(_s,_a,{run})=>{await run({});return {allowed:true};},
 run:async opts=>{assert.equal(opts.inspectInteractionUi,true);return opts.afterReady({settings:{},read:async(_s,{operation})=>{
  phases.push(operation.phase);
  if(operation.phase==='fill'){assert.equal(operation.text,'@dy_owner');assert.equal(operation.mentionOwner.platformId,'owner_12345');filled=true;return {allowed:true,operationResult:{ready:true,filled:true}};}
  if(operation.phase==='clear'){cleared=true;return {allowed:true,operationResult:{ready:true,cleared:true}};}
  if(operation.phase==='mention_inspect')return {allowed:true,operationResult:{ready:true,containerCount:1,verifiedOwnerCandidateCount:0}};
  return {allowed:true,operationResult:{ready:true,editorCount:1,editorEmpty:true}};
 }});}});
 assert.equal(filled,true);assert.equal(cleared,true);assert.equal(r.sent,false);assert.equal(r.mentionIdentityReady,false);assert.equal(r.selectionPerformed,false);
 assert.equal(phases.some(p=>p==='click_submit'||p==='click_like'),false);
});
test('mention search permission cannot be reused to submit @ text or query another handle',()=>{
 const common={videoId:'7551370789157637436',mentionOwner:{platformId:'owner_12345',handle:'dy_owner'},text:'@dy_owner'};
 for(const change of [{phase:'point_submit'},{phase:'input_guard',text:'@someone_else'},{phase:'mention_inspect',mentionOwner:{platformId:'../other',handle:'dy_owner'}}])assert.throws(()=>interactionExpression({...common,...change}),/Invalid owner mention/);
});

import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
import {captureVisibleCards} from '../../src/browser/visible-comment-cards.mjs';
import {replyComposerExpression} from '../../src/browser/open-reply-composer.mjs';
import {commentFingerprint,validateCommentSnapshot,validateReplyTarget} from '../../src/comment-policy.js';
import {freshState,transition,validateState} from '../../src/engine.js';
import {prepareCommentReply} from '../../src/comment-drafts.js';
import {readFile} from 'node:fs/promises';
import {previewExactReply} from '../../src/reply-preview.js';
const id='1234567890123456789',authorId='author_123',text='猫值班呢',url='https://www.douyin.com/jingxuan?modal_id='+id;
async function fixture({duplicate=false,wrongRoot=false,changed=false,replyControls=1,dialog=false}={}){
 let clicks=0;const el=()=>({children:[],getBoundingClientRect:()=>({width:100,height:100,top:0,bottom:100,left:0,right:100})});
 const control={...el(),innerText:'回复',click(){clicks++;}},node={...el(),innerText:text},author={...el(),innerText:'鱼片',getAttribute:()=>'/user/'+authorId};
 const item={...el(),querySelectorAll:s=>s==='.FduGc_lz'?[node]:s==='.comment-item-info-wrap a[href]'?[author]:Array.from({length:replyControls},()=>control)};
 const list={...el(),querySelectorAll:()=>duplicate?[item,item]:[item]},video={...el(),currentSrc:'private-media-url'},root={...el(),classList:{contains:()=>!wrongRoot},contains:()=>true};
 const document={querySelectorAll:s=>s==='[role="dialog"]'?(dialog?[root]:[]):s==='[data-e2e="feed-active-video"]'?[root]:s==='[data-e2e="comment-list"]'?[list]:s==='video'?[video]:[]};
 const key=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(video.currentSrc))).toString('hex');
 const base={url,captionBound:true,visibleVideoCount:1,videoKey:key,restriction:'',commentSnapshot:{status:'unsupported_structure',comments:[]}};
 const crypto=changed?{subtle:{digest:async(...args)=>{const d=await webcrypto.subtle.digest(...args);node.innerText='已换内容';return d;}}}:webcrypto;
 const scope={document,location:{href:url},URL,crypto,TextEncoder,innerHeight:800,innerWidth:1000,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
 return {capture:()=>vm.runInNewContext(`(${captureVisibleCards.toString()})(${JSON.stringify(base)})`,scope),reply:()=>vm.runInNewContext(replyComposerExpression(id,commentFingerprint(id,authorId,text)),scope),clicks:()=>clicks};
}
test('observed DOM cards use explicit local fingerprints without fabricated platform IDs',async()=>{
 const f=await fixture(),r=await f.capture(),c=validateCommentSnapshot(r.commentSnapshot,url);assert.equal(c.identityKind,'dom_fingerprint');assert.equal(c.comments[0].commentId,undefined);assert.equal(c.comments[0].localCommentKey,commentFingerprint(id,authorId,text));
 assert.equal(validateReplyTarget({sourceRef:url,videoId:id,authorId,identityKind:'dom_fingerprint',localCommentKey:c.comments[0].localCommentKey}).commentId,undefined);
});
test('duplicate cards, wrong video and changes during capture reject local bindings',async()=>{for(const opts of [{duplicate:true},{wrongRoot:true},{changed:true},{dialog:true}])assert.equal((await(await fixture(opts)).capture()).commentSnapshot.status,'unsupported_structure');});
test('card fingerprint must actually match video, author and content',()=>{const snapshot={status:'bound_visible_cards',videoId:id,comments:[{authorId,authorName:'鱼片',text,localCommentKey:'0'.repeat(64)}]};assert.throws(()=>validateCommentSnapshot(snapshot,url));});
test('reply diagnostic opens only one exact matching reply control without filling or sending',async()=>{const f=await fixture();assert.equal((await f.reply()).clicked,true);assert.equal(f.clicks(),1);for(const opts of [{duplicate:true},{wrongRoot:true},{changed:true},{replyControls:2},{replyControls:0},{dialog:true}]){const f=await fixture(opts);assert.equal((await f.reply()).clicked,false);assert.equal(f.clicks(),0);}});
test('reply expression rejects arbitrary injected identities',()=>{assert.throws(()=>replyComposerExpression(id,'x);evil()'));});
test('DOM-bound reply draft preserves its local target without inventing a comment ID',async()=>{
 const base=JSON.parse(await readFile(new URL('../../config/default-settings.json',import.meta.url),'utf8')),s=freshState(),at=1800000000000;
 const localCommentKey=commentFingerprint(id,authorId,text);
 s.resources.commentReads=[{id:'12345678-1234-1234-1234-123456789abc',at,expiresAt:at+900000,sourceRef:url,caption:'猫看雨',snapshot:{status:'bound_visible_cards',videoId:id,comments:[{authorId,authorName:'鱼片',text,localCommentKey}]}}];
 const prepared=prepareCommentReply(base,s,{snapshotId:s.resources.commentReads[0].id,commentKey:localCommentKey},at+1);assert.equal(prepared.value.allowed,true);
 const saved=transition(base,prepared.state,'manual_finish',{requestId:prepared.value.requestId,text:'小鱼负责吃饭。'},at+2);
 assert.equal(saved.value.draft.replyTarget.localCommentKey,localCommentKey);assert.equal(saved.value.draft.replyTarget.commentId,undefined);assert.equal(saved.value.draft.status,'copy_only_unsent');validateState(saved.state);
});
test('reply preview uses the saved exact target and cannot fill or send',async()=>{
 const target={sourceRef:url,videoId:id,authorId,identityKind:'dom_fingerprint',localCommentKey:commentFingerprint(id,authorId,text)};
 const store={snapshot:async()=>({lastTime:0,resources:{manualDrafts:[{id:'draft',kind:'comment',replyTarget:target}]}})};
 const r=await previewExactReply({}, {confirm:'open_exact_reply_without_sending',draftId:'draft'},{store,now:()=>1800000000000,read:async(_s,args,deps)=>{
  assert.equal(args.sourceRef,url);await deps.run({approved:true});return {allowed:true};
 },run:async options=>{assert.equal(options.probeReplyKey,target.localCommentKey);assert.equal(options.probeReplyComposer,true);return {};}});
 assert.equal(r.sent,false);assert.equal(r.filled,false);assert.equal(r.sendingSupported,false);
});
test('reply preview refuses missing bindings or confirmation before accessing browser',async()=>{
 assert.equal((await previewExactReply({}, {},{})).reason,'explicit_reply_preview_required');
 assert.equal((await previewExactReply({}, {confirm:'open_exact_reply_without_sending',draftId:'missing'},{store:{snapshot:async()=>({lastTime:0,resources:{}})}})).reason,'bound_comment_draft_required');
});

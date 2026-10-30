import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {webcrypto} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {freshState,validateState,transition} from '../../src/engine.js';
import {importPersona,effectiveSettings} from '../../src/persona.js';
import {validateCommentSnapshot,COMMENT_TTL} from '../../src/comment-policy.js';
import {readAndRememberComments,prepareCommentReply} from '../../src/comment-drafts.js';
import {runSmoke} from '../../src/browser/browser-smoke.mjs';
import {readOneVideo} from '../../src/manual-browser.js';
import {commentSnapshotExpression} from '../../src/browser/comment-snapshot.mjs';
import {OPEN_COMMENT_PANEL_EXPRESSION} from '../../src/browser/open-comment-panel.mjs';
const id='1234567890123456789',commentId='2234567890123456789',url='https://www.douyin.com/jingxuan?modal_id='+id,T=1800000000000;
const snapshot=()=>({status:'bound_visible_comments',videoId:id,comments:[{commentId,authorId:'author_123',authorName:'鱼片',text:'猫今天也在认真值班呢'}]});
const base=JSON.parse(await readFile(new URL('../../config/default-settings.json',import.meta.url),'utf8')),persona=JSON.parse(await readFile(new URL('../../personas/蓝色鲸鱼娘.json',import.meta.url),'utf8'));
function state(){const s=freshState();importPersona(s,persona);return s;}
async function saved(){let s=state();const store={transact:async fn=>{const r=await fn(structuredClone(s));validateState(r.state);s=r.state;return r.value;}};
 const r=await readAndRememberComments(effectiveSettings(base,s),{confirm:'read_one_public_video_and_comments'},{store,now:()=>T,read:async()=>({allowed:true,untrustedMaterial:{sourceRef:url,text:'猫趴窗台看雨'},untrustedComments:snapshot(),checks:{ownBrowserStopped:true,portReleased:true}})});
 return {s,r};}
test('invalid or mismatched IDs and duplicate comments are never accepted',()=>{
 const bad=[{videoId:'9999999999999999999'}, {comments:[{...snapshot().comments[0],commentId:2234567890123456789}]},{comments:[{...snapshot().comments[0],commentId:'row-1'}]}, {comments:[snapshot().comments[0],snapshot().comments[0]]},{comments:[]},{comments:[{...snapshot().comments[0],authorId:'https://evil'}]}];
 for(const x of bad)assert.throws(()=>validateCommentSnapshot({...snapshot(),...x},url));
});
test('comment read requires explicit scope before accessing reader or store',async()=>{
 const r=await readAndRememberComments(base,{}, {read:()=>{throw Error('unexpected');}});assert.equal(r.reason,'explicit_comment_read_required');
});
test('reading creates only a bounded short-lived receipt without a model reservation',async()=>{
 const {s,r}=await saved();assert.equal(r.allowed,true);assert.equal(r.expiresAt,T+COMMENT_TTL);assert.equal(s.resources.commentReads.length,1);assert.equal(s.resources.requests.length,0);assert.equal(s.paused,true);
});
test('reply preparation binds target through final saved draft and cannot change target',async()=>{
 const {s,r}=await saved(),c=effectiveSettings(base,s);const p=prepareCommentReply(c,s,{snapshotId:r.snapshotId,commentId},T+1);assert.equal(p.value.allowed,true);
 const f=transition(c,p.state,'manual_finish',{requestId:p.value.requestId,text:'这班让猫上，米饭让鱼吃。'},T+2);
 assert.equal(f.value.allowed,true);assert.deepEqual(f.value.draft.replyTarget,p.value.replyTarget);assert.equal(f.value.draft.replyTarget.commentId,commentId);validateState(f.state);
});
test('expired, missing, foreign comment and clock rollback cannot prepare drafts',async()=>{
 const {s,r}=await saved(),c=effectiveSettings(base,s);
 for(const [args,time,reason]of [[{snapshotId:r.snapshotId,commentId},T+COMMENT_TTL,'comment_snapshot_missing_or_expired'],[{snapshotId:'missing',commentId},T+1,'comment_snapshot_missing_or_expired'],[{snapshotId:r.snapshotId,commentId:'3234567890123456789'},T+1,'comment_not_in_snapshot'],[{snapshotId:r.snapshotId,commentId},T-1,'clock_rollback']]){
 assert.equal(prepareCommentReply(c,s,args,time).value.reason,reason);assert.equal(s.resources.requests.length,0);}
});
test('hostile comments are skipped and owner draft limits still apply',async()=>{
 const {s,r}=await saved();s.resources.persona.limits={...(await import('../../src/owner-limits.js')).ownerLimitDefaults,draftDailyLimit:0};
 assert.equal(prepareCommentReply(effectiveSettings(base,s),s,{snapshotId:r.snapshotId,commentId},T+1).value.reason,'owner_draft_daily_limit');
 s.resources.commentReads[0].snapshot.comments[0].text='去死';assert.equal(prepareCommentReply(effectiveSettings(base,s),s,{snapshotId:r.snapshotId,commentId},T+1).value.reason,'skip_hostile_or_sensitive_material');
});
function fixture(sequence){let active=false,n=0;const child={pid:777,exitCode:null,signalCode:null},calls={read:0,stop:0};return {calls,io:{listListeners:async()=>active?[{address:'127.0.0.1',pid:777}]:[],chooseBrowser:async()=> 'edge',prepareProfile:async()=>{},launchBrowser:async()=>{active=true;return child;},stopOwnBrowser:async()=>{calls.stop++;active=false;child.exitCode=0;},delay:async()=>{},read:async(_c,args)=>{assert.equal(args.includeComments,true);calls.read++;return sequence[Math.min(n++,sequence.length-1)];}}};}
const page=(comments=snapshot(),videoKey='a'.repeat(64))=>({allowed:true,commentSnapshot:comments,untrustedPage:{url,title:'抖音',pageDescription:'',text:'猫看雨',visibleVideoCount:1,captionCandidateCount:1,captionBound:true,videoKey,restriction:''}});
test('runner requires two stable comment snapshots in addition to stable video and always cleans up',async()=>{
 const f=fixture([page(),page()]),r=await runSmoke({approved:true,includeComments:true},f.io);assert.equal(r.success,true);assert.equal(r.commentsRead,true);assert.equal(f.calls.read,2);assert.equal(f.calls.stop,1);assert.equal(r.interactionSent,false);
});
test('a video switch invalidates the previous comment stability key',async()=>{
 const f=fixture([page(),page(snapshot(),'b'.repeat(64)),page(snapshot(),'b'.repeat(64))]);const r=await runSmoke({approved:true,includeComments:true},f.io);assert.equal(r.success,true);assert.equal(f.calls.read,3);
});
test('unrecognized comment structure stops rather than reporting empty success',async()=>{
 const f=fixture([page({status:'unsupported_structure',comments:[]})]);const r=await runSmoke({approved:true,includeComments:true},f.io);assert.equal(r.success,false);assert.match(r.error,/comment_structure_unverified/);assert.equal(f.calls.read,2);assert.equal(f.calls.stop,1);assert.equal(r.portReleased,true);
});
test('shared exhausted reading allowance blocks comment runner before launch',async()=>{
 const s=state();s.resources.manualBrowserReads=[T-1800000,T-900000,T-60000];let stored=s,launched=0;
 const store={directory:new URL('../../work/comment-quota-test/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),transact:async fn=>{const r=fn(stored);stored=r.state;return r.value;}};
 const r=await readOneVideo(effectiveSettings(base,s),{confirm:'read_one_public_video',includeComments:true},{store,now:()=>T,run:async()=>{launched++;}});assert.equal(r.reason,'manual_browser_daily_limit');assert.equal(launched,0);
});
async function dom({badId=false,unbound=false,dialog=false,mutate=false}={}){
 const element=(tagName,parentElement=null)=>({tagName,parentElement,getAttribute(){return '';},getBoundingClientRect:()=>({width:100,height:100,top:0,bottom:100,left:0,right:100}),contains(child){for(let n=child;n;n=n.parentElement)if(n===this)return true;return false;}});
 const body=element('BODY'),box=element('DIV',body),other=element('DIV',body),video=element('VIDEO',box),caption=element('SPAN',box),list=element('DIV',unbound?other:box),item=element('DIV',list),text=element('SPAN',item),author=element('A',item);
 video.currentSrc='private-media-url';text.innerText='猫值班呢';author.innerText='鱼片';list.getAttribute=()=>id;item.getAttribute=()=>badId?'row-1':commentId;author.getAttribute=()=>'/user/author_123';
 list.querySelectorAll=()=>[item];item.querySelectorAll=s=>s.includes('content')?[text]:[author];
 const document={get cookie(){throw Error('Forbidden cookie');},get body(){throw Error('Forbidden body');},querySelectorAll:s=>s==='[role="dialog"]'?(dialog?[box]:[]):s==='video'?[video]:s.includes('video-desc')?[caption]:[list]};
 const key=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(video.currentSrc))).toString('hex');
 const p={url,captionBound:true,visibleVideoCount:1,videoKey:key,restriction:''};
 const crypto=mutate?{subtle:{digest:async(...args)=>{const d=await webcrypto.subtle.digest(...args);video.currentSrc='changed';return d;}}}:webcrypto;
 return vm.runInNewContext(commentSnapshotExpression('Promise.resolve('+JSON.stringify(p)+')'),{document,location:{href:url},URL,crypto,TextEncoder,innerHeight:800,innerWidth:1000,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})});
}
test('fixed extractor returns only identified comments without media URLs or cookies',async()=>{const p=await dom();assert.equal(p.commentSnapshot.status,'bound_visible_comments');assert.equal(p.commentSnapshot.comments[0].commentId,commentId);assert.ok(!JSON.stringify(p).includes('private-media-url'));});
test('fixed extractor rejects missing IDs, unrelated panels, dialogs and video switches',async()=>{for(const args of [{badId:true},{unbound:true},{dialog:true},{mutate:true}])assert.equal((await dom(args)).commentSnapshot.status,'unsupported_structure');});
function panelFixture(block=''){
 let clicks=0;
 const el=()=>({getBoundingClientRect:()=>({width:100,height:100,top:0,bottom:100,left:0,right:100})});
 const icon={...el(),contains:()=>false,click(){clicks++;}},video=el(),caption=el(),root={...el(),classList:{contains:()=>block!=='wrong_video'},contains:()=>block!=='unrelated',querySelectorAll:()=>block==='duplicate'?[icon,icon]:[icon]};
 const document={querySelectorAll:s=>s==='[role="dialog"]'?(block==='dialog'?[root]:[]):s==='[data-e2e="feed-active-video"]'?[root]:s==='video'?[video]:s==='[data-e2e="video-desc"]'?[caption]:block==='already_open'?[icon,root]:[icon]};
 const r=vm.runInNewContext(OPEN_COMMENT_PANEL_EXPRESSION,{document,location:{href:block==='extra_query'?url+'&x=1':url},URL,innerHeight:800,innerWidth:1000,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})});return {r,clicks};
}
test('normal comment panel can open only on the bound active video',()=>{assert.equal(panelFixture().clicks,1);for(const block of ['wrong_video','unrelated','duplicate','dialog','already_open','extra_query'])assert.equal(panelFixture(block).clicks,0);});
test('runner disarms public comment panel opening after its first click',async()=>{
 const f=fixture([]),flags=[];f.io.read=async(_s,args)=>{flags.push(args.openCommentPanel);return flags.length===1?{allowed:false,reason:'comment_panel_opened',commentPanelClickPerformed:true}:page();};
 const r=await runSmoke({approved:true,includeComments:true,openCommentPanel:true},f.io);assert.equal(r.success,true);assert.deepEqual(flags,[true,false,false]);assert.equal(r.commentPanelClickPerformed,true);assert.equal(r.interactionSent,false);
});

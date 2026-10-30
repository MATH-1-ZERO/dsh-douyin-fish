import test from 'node:test';
import assert from 'node:assert/strict';
import {validOwnerVideoLink} from './share-policy.js';
import {sendOwnerVideoLink} from './video-share.js';
import {validateIntent} from './interaction-gate.js';
const id='7551370789157637436',sourceRef='https://www.douyin.com/jingxuan?modal_id='+id;
test('sharing constructs only the exact canonical Douyin video URL and reports a text link, not a card',async()=>{
 let sent=0;
 const r=await sendOwnerVideoLink({}, {confirm:'send_one_video_link_to_boss',sourceRef,text:'老大，这条小鱼想给你看看。'},{send:async(_s,args,deps)=>{
  sent++;assert.equal(args.text,'老大，这条小鱼想给你看看。\nhttps://www.douyin.com/video/'+id);assert.equal(deps.sharedVideoId,id);return {allowed:true};
 }});
 assert.equal(sent,1);assert.equal(r.nativeShareCard,false);assert.equal(r.linkClickabilityVerified,false);
});
test('general DMs still reject links and share permission cannot carry arbitrary URLs',async()=>{
 const dm={kind:'dm',identityKind:'verified_owner_profile_navigation',recipientId:'owner_12345',sourceRef:'https://www.douyin.com/user/owner_12345',text:'老大，给你看看。\nhttps://www.douyin.com/video/'+id};
 assert.throws(()=>validateIntent(dm));assert.equal(validateIntent({...dm,sharedVideoId:id}).sharedVideoId,id);
 for(const text of ['广告https://evil.example/\nhttps://www.douyin.com/video/'+id,'老大\nhttps://evil.example/','老大\nhttps://www.douyin.com/video/'+id+'?redirect=https://evil.example/','@别人\nhttps://www.douyin.com/video/'+id])assert.equal(validOwnerVideoLink(text,id),false);
 await assert.rejects(sendOwnerVideoLink({}, {confirm:'send_one_video_link_to_boss',sourceRef:'https://evil.example/',text:'老大'},{}));
});

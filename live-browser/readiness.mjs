import {approvedVideoPage} from './route-policy.mjs';
export class VideoReadiness {
  constructor(){this.previous=null;this.pageRead=false;this.videoRead=false;this.lastPage=null;}
  observe(result){
    const reject=(reason,terminal=false)=>{this.previous=null;return {ready:false,terminal,reason};};
    if(!result?.allowed)return reject(result?.reason??'invalid_result',!['no_allowed_test_page','page_not_ready','expected_video_navigation_pending','public_video_opened','comment_panel_opened','reply_composer_opened'].includes(result?.reason));
    const p=result.untrustedPage;
    if(!approvedVideoPage(p?.url)||typeof p.title!=='string'||!p.title.includes('抖音'))return reject('unexpected_page',true);
    if(!['','login','verification'].includes(p.restriction))return reject('invalid_restriction',true);
    if(p.restriction)return reject(p.restriction+'_dialog_visible',true);
    this.pageRead=true;this.lastPage=p;
    if(!Number.isInteger(p.visibleVideoCount)||p.visibleVideoCount<0||!Number.isInteger(p.captionCandidateCount)||p.captionCandidateCount<0)return reject('invalid_candidate_count',true);
    if(p.visibleVideoCount>1||p.captionCandidateCount>1)return reject('ambiguous_video_or_caption',true);
    if(p.visibleVideoCount!==1||p.captionCandidateCount!==1)return reject('video_content_not_ready');
    if(p.captionBound!==true||typeof p.videoKey!=='string'||! /^[a-f0-9]{64}$/.test(p.videoKey))return reject('video_caption_not_bound');
    if(typeof p.text!=='string'||!p.text.trim()||p.text.length>1000)return reject('video_content_not_ready');
    const key=p.url+'\n'+p.videoKey+'\n'+p.text;
    if(this.previous!==key){this.previous=key;return {ready:false,terminal:false,reason:'awaiting_stable_video'};}
    this.videoRead=true;
    return {ready:true,terminal:false,reason:'stable_video_caption'};
  }
}

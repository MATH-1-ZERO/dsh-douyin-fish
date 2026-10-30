import {videoIdFromPage} from './comment-policy.js';
import {sendOwnerDm} from './owner-dm.js';
import {validOwnerVideoLink} from './share-policy.js';
export async function sendOwnerVideoLink(settings,args,deps){
 if(args.confirm!=='send_one_video_link_to_boss')return {allowed:false,reason:'explicit_video_link_share_required',sendAttempted:false};
 const id=videoIdFromPage(args.sourceRef);
 if(!id||typeof args.text!=='string'||[...args.text].length>40)throw Error('Exact video and short sharing text required');
 const text=args.text+'\nhttps://www.douyin.com/video/'+id;
 if(!validOwnerVideoLink(text,id))throw Error('Invalid fixed Douyin video link');
 const sent=await (deps.send??sendOwnerDm)(settings,{confirm:'send_one_exact_owner_dm',text},{...deps,sharedVideoId:id});
 return {...sent,sharedVideoId:id,shareKind:'plain_text_video_link',nativeShareCard:false,recipientReadVerified:false,linkClickabilityVerified:false};
}

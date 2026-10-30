export function validOwnerVideoLink(text,videoId){
 if(typeof videoId!=='string'||!/^\d{10,25}$/.test(videoId)||typeof text!=='string'||[...text].length>100)return false;
 const suffix='\nhttps://www.douyin.com/video/'+videoId;
 if(!text.endsWith(suffix))return false;
 const body=text.slice(0,-suffix.length);
 return !!body.trim()&&body.trim()===body&&!/[\r\n@＠]|https?:\/\//iu.test(body);
}

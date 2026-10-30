import {pageRestriction} from './page-restriction.mjs';
export function avatarResource(source){
 try{const u=new URL(source);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.pathname.split('~')[0]:null;}catch{return null;}
}
function captureOwner(expected,restriction,avatarKey){
 if(location.href!==expected.profile||restriction())return {ready:false,reason:'owner_profile_restricted_or_changed'};
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0;};
 const labels=[...document.querySelectorAll('span,p,div')].filter(visible).filter(e=>!e.children.length&&(e.innerText||'').replace(/\s/g,'').replace('：',':')==='抖音号:'+expected.ownerHandle);
 const ownerName=document.title.match(/^(.{1,60})的抖音(?: - 抖音)?$/u)?.[1];
 // The real profile page publishes its title very late (observed 30s-90s), so a
 // missing title is a pending state, not a handle mismatch.
 if(labels.length!==1)return {ready:false,reason:'owner_handle_not_unique'};
 if(!ownerName)return {ready:false,reason:'owner_profile_title_pending'};
 let container=labels[0].parentElement;
 for(let i=0;container&&i<8;i++,container=container.parentElement){
  if(['BODY','HTML'].includes(container.tagName))break;
  const images=[...container.querySelectorAll('img')].filter(visible).filter(img=>{
   const r=img.getBoundingClientRect();if(r.width<65||r.width>200||Math.abs(r.width-r.height)>4||r.top>500)return false;
   return [img,img.parentElement,img.parentElement?.parentElement].filter(Boolean).some(n=>{const radius=getComputedStyle(n).borderRadius;return radius==='50%'||parseFloat(radius)>=r.width/3;});
  });
  if(images.length===1){const key=avatarKey(images[0].currentSrc||images[0].getAttribute('src'));if(key)return {ready:true,ownerName,avatarResource:key,profileHandleVerified:true};}
 }
 return {ready:false,reason:'owner_profile_avatar_not_bound'};
}
export function ownerPublicProofExpression(profile,ownerHandle){
 const u=new URL(profile);
 if(u.origin!=='https://www.douyin.com'||!/^\/user\/[A-Za-z0-9_-]{5,200}$/.test(u.pathname)||u.search||u.hash||u.username||u.password||!/^[-A-Za-z0-9_.]{1,80}$/.test(ownerHandle))throw Error('Exact owner public profile required');
 return `(${captureOwner.toString()})(${JSON.stringify({profile,ownerHandle})},${pageRestriction.toString()},${avatarResource.toString()})`;
}

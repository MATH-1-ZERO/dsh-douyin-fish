import {profilePage} from './scoped-ui.mjs';
import {pageRestriction} from './page-restriction.mjs';

function positionOwnerProfile(profile,restrictionCheck){
 const deny=reason=>({ready:false,reason,scrollPerformed:false,profileIdentityVerified:false});
 if(location.href!==profile)return deny('owner_profile_changed');
 if(document.visibilityState!=='visible')return deny('owner_dm_page_hidden');
 const restriction=restrictionCheck();
 if(restriction)return deny('manual_'+restriction+'_required');
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0&&r.left<innerWidth&&r.right>0&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0;};
 // Preserve any live text input. Neither its value nor private message text is
 // returned; positioning is only preparation for the caller's identity check.
 const fields=[...document.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],[contenteditable=""],textarea,input')].filter(visible).filter(e=>e.tagName!=='INPUT'||!['hidden','button','submit','reset','checkbox','radio','range','color','image','file'].includes((e.getAttribute('type')||'text').toLowerCase()));
 if(fields.some(e=>String(e.value??e.innerText??'').replace(/[\u200B\uFEFF]/g,'').trim()))return deny('existing_input_preserved');
 const containers=[...document.querySelectorAll('.parent-route-container.route-scroll-container')].filter(visible);
 if(containers.length!==1)return deny('owner_profile_scroll_container_ambiguous');
 const container=containers[0],before=container.scrollTop;
 if(!Number.isFinite(before)||before<0)return deny('owner_profile_scroll_position_invalid');
 if(before===0)return {ready:true,scrollPerformed:false,profileIdentityVerified:false};
 if(typeof container.scrollTo!=='function')return deny('owner_profile_scroll_not_supported');
 container.scrollTo({top:0,behavior:'instant'});
 // A failed scroll has no fallback to reloading or moving the whole document.
 if(container.scrollTop!==0)return {ready:false,reason:'owner_profile_scroll_not_applied',scrollPerformed:true,profileIdentityVerified:false};
 return {ready:true,scrollPerformed:true,profileIdentityVerified:false};
}

export function ownerProfilePositionExpression(profile){
 if(typeof profile!=='string'||profilePage(profile)!==profile)throw Error('Exact public owner profile required');
 return `(${positionOwnerProfile.toString()})(${JSON.stringify(profile)},${pageRestriction.toString()})`;
}

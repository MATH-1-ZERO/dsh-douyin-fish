// Fixed visible-label checks only. Never inspect input values, cookies or tokens.
export function pageRestriction(){
 const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0;};
 const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible).slice(0,10).map(e=>(e.innerText||'').slice(0,500)).join(' ');
 if(/验证码|安全验证|滑块|访问频繁|操作频繁|访问受限|captcha|access denied/i.test(dialogs))return 'verification';
 // Douyin's SMS identity overlay has no role=dialog in the observed build.
 const labels=[...document.querySelectorAll('h1,h2,h3,[role="heading"],span,p,div')].filter(e=>!e.children?.length&&visible(e)&&!e.closest?.('[contenteditable], [data-e2e="comment-item"], [data-e2e="video-desc"], [data-e2e="msg-item-content"]'));
 if(labels.some(e=>/^(接收短信验证码|安全验证|身份验证|短信验证|请完成安全验证|请完成身份验证|使用原设备扫码)$/.test((e.innerText||'').trim())))return 'verification';
 // The login panel can also lack role=dialog. Exact UI labels only; never
 // treat arbitrary video captions or chat text mentioning login as a gate.
 if(labels.some(e=>/^(登录抖音|抖音登录|扫码登录|验证码登录|手机号登录|短信登录|账号密码登录|请先登录|登录后即可(?:私信|评论|分享)|登录后继续)$/.test((e.innerText||'').trim())))return 'login';
 return /登录|扫码|sign in|log in/i.test(dialogs)?'login':'';
}

import {approvedVideoPage} from './browser/route-policy.mjs';
import {createHash} from 'node:crypto';
export const commentFingerprint=(videoId,authorId,text)=>createHash('sha256').update(JSON.stringify([videoId,authorId,text])).digest('hex');
export const COMMENT_TTL=15*60000;
export function validateCommentReceipts(receipts){
  if(!Array.isArray(receipts)||receipts.length>5)throw Error('Invalid comment receipts');
  const seen=new Set();
  for(const r of receipts){
    if(!r||typeof r.id!=='string'||!/^[a-f0-9-]{36}$/.test(r.id)||seen.has(r.id)||!Number.isSafeInteger(r.at)||r.at<0||r.expiresAt!==r.at+COMMENT_TTL||typeof r.caption!=='string'||[...r.caption].length>200)throw Error('Invalid comment receipt');
    validateCommentSnapshot(r.snapshot,r.sourceRef);seen.add(r.id);
  }
}
export function videoIdFromPage(url){const checked=approvedVideoPage(url);if(!checked)return null;const u=new URL(checked);return u.pathname.match(/^\/video\/(\d{10,25})$/)?.[1]||u.searchParams.get('modal_id');}
export function validateCommentSnapshot(snapshot,url){
  const id=videoIdFromPage(url);
  if(!id||!snapshot||!['bound_visible_comments','bound_visible_cards'].includes(snapshot.status)||snapshot.videoId!==id||!Array.isArray(snapshot.comments)||snapshot.comments.length<1||snapshot.comments.length>3)throw Error('Unverified comment structure or video binding');
  const local=snapshot.status==='bound_visible_cards';
  const seen=new Set();
  for(const c of snapshot.comments){
    if(!c||typeof c.authorId!=='string'||!/^[A-Za-z0-9_-]{5,200}$/.test(c.authorId)||typeof c.authorName!=='string'||[...c.authorName].length>60||typeof c.text!=='string'||!c.text.trim()||[...c.text].length>300)throw Error('Invalid comment identity or text');
    const key=local?c.localCommentKey:c.commentId;
    if(local?typeof key!=='string'||key!==commentFingerprint(id,c.authorId,c.text):typeof key!=='string'||!/^\d{10,25}$/.test(key))throw Error('Invalid comment identity');
    if(seen.has(key))throw Error('Ambiguous comment identity');seen.add(key);
  }
  return {status:snapshot.status,videoId:id,...(local?{identityKind:'dom_fingerprint'}:{}),comments:snapshot.comments.map(({commentId,localCommentKey,authorId,authorName,text})=>({...(local?{localCommentKey}:{commentId}),authorId,authorName,text}))};
}
export function validateReplyTarget(t){
  if(t?.identityKind==='dom_fingerprint'){
    if(!t.videoId||videoIdFromPage(t.sourceRef)!==t.videoId||typeof t.authorId!=='string'||!/^[A-Za-z0-9_-]{5,200}$/.test(t.authorId)||typeof t.localCommentKey!=='string'||!/^[a-f0-9]{64}$/.test(t.localCommentKey))throw Error('Invalid DOM reply binding');
    return {sourceRef:t.sourceRef,videoId:t.videoId,authorId:t.authorId,identityKind:t.identityKind,localCommentKey:t.localCommentKey};
  }
  if(!t||!t.videoId||videoIdFromPage(t.sourceRef)!==t.videoId||typeof t.commentId!=='string'||!/^\d{10,25}$/.test(t.commentId)||typeof t.authorId!=='string'||!/^[A-Za-z0-9_-]{5,200}$/.test(t.authorId))throw Error('Invalid comment reply target');
  return {sourceRef:t.sourceRef,videoId:t.videoId,commentId:t.commentId,authorId:t.authorId};
}

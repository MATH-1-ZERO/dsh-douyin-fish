// Only the visible, hydrated heart establishes a state. A stale e2e label,
// count change, hidden icon or dark placeholder is insufficient.
export function classifyLikeState(info){
 if(!info)return 'unknown';
 const colors=(info.visibleSvg??[]).map(e=>e.computedFill?.replace(/\s/g,'').toLowerCase());
 const red=colors.includes('rgb(254,44,85)')||colors.includes('#fe2c55');
 const white=colors.includes('rgb(255,255,255)')||colors.includes('#ffffff');
 const pressed=info.ariaPressed==='true'||info.e2eState==='video-player-digged';
 if(red&&white)return 'unknown';
 if(red)return 'liked';
 if(white&&!pressed&&info.e2eState==='video-player-no-digged')return 'unliked';
 return 'unknown';
}

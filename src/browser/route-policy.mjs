export function approvedVideoPage(value){
  try {
    const u=new URL(value);
    if(u.origin!=='https://www.douyin.com'||u.username||u.password||u.hash)return null;
    if(/^\/video\/\d{10,25}$/.test(u.pathname)&&!u.search)return u.href;
    if(u.pathname!=='/jingxuan')return null;
    if(!u.search)return u.href;
    const entries=[...u.searchParams];
    return entries.length===1&&entries[0][0]==='modal_id'&&/^\d{10,25}$/.test(entries[0][1])?u.href:null;
  }catch{return null;}
}

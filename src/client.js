window.__ModuleLoader__.load({
 id:'@local/dsh-douyin-fish',
 factory(require){
  const React=require('react'),h=React.createElement;
  const validUrl=value=>{try{const url=new URL(value);return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.pathname==='/'&&!url.search&&!url.username&&!url.password&&/^#access=[a-f0-9]{64}$/.test(url.hash)?url.href:null;}catch{return null;}};
  const frame={background:'#fff8ef',border:'1px solid #eed8c9',borderRadius:24,padding:'28px 24px',color:'#5d453d',margin:'12px 0',lineHeight:1.7};
  const buttonStyle={border:0,borderRadius:14,padding:'11px 20px',background:'#b95d45',color:'#fffaf5',font:'inherit',cursor:'pointer',fontWeight:600};
  function Mascot(){return h('svg',{width:120,height:84,viewBox:'0 0 160 110','aria-hidden':true},h('ellipse',{cx:77,cy:98,rx:51,ry:7,fill:'#edd1bc',opacity:.5}),h('path',{d:'M21 57C15 29 48 19 74 28c17 4 29 16 37 26 8-13 18-17 32-15-3 15-10 25-26 28-9 25-43 35-72 23C28 84 20 73 21 57Z',fill:'#9ebdcb'}),h('path',{d:'M23 63c16 24 56 27 85 4-15 30-73 37-85-4Z',fill:'#d9e4df'}),h('circle',{cx:42,cy:53,r:3.6,fill:'#594a4a'}),h('circle',{cx:40,cy:63,r:7,fill:'#f0b5a8'}),h('path',{d:'M54 60q7 6 13-1M59 18q-5-10 2-15M68 19q5-8 12-7',stroke:'#668996',strokeWidth:3,strokeLinecap:'round',fill:'none'}));}
  function Launcher(){
   const [state,setState]=React.useState({phase:'opening',url:null}),[copyStatus,setCopyStatus]=React.useState(''),pending=React.useRef(null),mounted=React.useRef(false);
   const copyUrl=async()=>{try{await navigator.clipboard.writeText(state.url);setCopyStatus('已复制，请粘贴到这台电脑的浏览器地址栏。');}catch{setCopyStatus('请点击下方地址框，按 Ctrl+C 复制，再粘贴到浏览器地址栏。');}};
   const launch=()=>{
    if(pending.current)return pending.current;
    if(mounted.current)setState({phase:'opening',url:null});
    pending.current=(async()=>{
     try{
      const response=await fetch('api/douyin-fish/console-open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({intent:'open_console'})});
      const result=await response.json(),url=validUrl(result.url);
      if(!response.ok||result.allowed!==true||!url)throw Error('unavailable');
      if(mounted.current)setState({phase:result.opened?'opened':'fallback',url});
     }catch{if(mounted.current)setState({phase:'error',url:null});}
     finally{pending.current=null;}
    })();return pending.current;
   };
   React.useEffect(()=>{mounted.current=true;void launch();return()=>{mounted.current=false;};},[]);
   return h('section',{'data-fish-launcher':'',style:frame},h(Mascot),h('p',{style:{fontSize:12,color:'#996f59',margin:'8px 0'}},'大肥鱼 · 小小世界'),
    h('h2',{style:{fontSize:24,margin:'4px 0 12px',fontWeight:650}},state.phase==='opening'?'正在叫小鱼开门…':state.url?'小鱼的控制台已就绪。':'小鱼在这里等你。'),
    h('p',{role:'status',style:{fontSize:14,margin:'0 0 20px'}},state.phase==='error'?'暂时没能打开，请点击下面的按钮重试。':state.phase==='fallback'?'浏览器没有自动打开，请使用下面的链接。':'在人设、记忆与账单之间，看看小鱼的近况。'),
    h('button',{type:'button',style:{...buttonStyle,opacity:state.phase==='opening'?.55:1},disabled:state.phase==='opening',onClick:launch},state.phase==='opening'?'正在打开…':state.phase==='opened'?'再打开一次':'打开控制台'),
    state.url?h('a',{href:state.url,target:'_blank',rel:'noopener noreferrer',style:{display:'inline-block',marginLeft:16,color:'#985541',fontSize:13}},'在浏览器中查看 ↗'):null,
    state.url?h('div',{style:{marginTop:20}},h('button',{type:'button',style:{...buttonStyle,background:'#886654'},onClick:copyUrl},'复制控制台地址'),h('p',{style:{fontSize:13}},copyStatus||'没有弹出浏览器？复制下方地址，在本机 Edge 或其他浏览器中打开。'),h('input',{'aria-label':'本机控制台地址',readOnly:true,value:state.url,onFocus:event=>event.target.select(),onClick:event=>event.target.select(),style:{boxSizing:'border-box',width:'100%',padding:12,border:'1px solid #e7caba',borderRadius:10,background:'#fff',color:'#59473e'}})):null,
    h('p',{style:{fontSize:12,color:'#89776a',margin:'20px 0 0'}},'打开页面不会自动启动回复。'));
  }
  return {inject:['slots'],apply(ctx){ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'douyin-fish-console',order:90,label:'大肥鱼控制台'},Launcher));}};
 }
});

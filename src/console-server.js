import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
const matches=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&b.length===64&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class FishConsole{
 constructor({snapshot,commands={}}){this.snapshot=snapshot;this.commands=commands;this.server=null;this.starting=null;this.closing=false;}
 async open(){
  if(this.closing)throw Error('Console is closing');
  if(this.starting)return this.starting;
  if(this.server)return {allowed:true,url:this.origin+'/#access='+this.ownerToken,localOnly:true};
  this.starting=this.#listen();
  try{return await this.starting;}finally{this.starting=null;}
 }
 async #listen(){
  this.ownerViewCount=0;
  this.ownerToken=randomBytes(32).toString('hex');this.guestToken=randomBytes(32).toString('hex');
  const server=createServer((req,res)=>{void this.#request(req,res).catch(()=>{if(!res.headersSent)this.#json(res,500,{error:'控制台暂时无法读取状态，请稍后刷新。'});else res.end();});});
  server.requestTimeout=10000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  this.server=server;this.origin='http://127.0.0.1:'+server.address().port;
  return {allowed:true,url:this.origin+'/#access='+this.ownerToken,localOnly:true};
 }
 status(){return {running:!!this.server,localOnly:true,ownerViewCount:this.ownerViewCount??0};}
 async close(){
  this.closing=true;
  try{if(this.starting)await this.starting.catch(()=>{});const server=this.server;this.server=null;this.ownerToken=null;this.guestToken=null;if(server)await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});}
  finally{this.closing=false;}
 }
 #json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
 async #request(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if(req.headers.host!==new URL(this.origin).host||req.headers.origin&&req.headers.origin!==this.origin)return this.#json(res,403,{error:'仅允许本机控制台访问。'});
  const url=new URL(req.url,this.origin);
  if(req.method==='GET'&&assets[url.pathname]&&!url.search){const [file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type});res.end(await readFile(new URL('../console/'+file,import.meta.url)));return;}
  const token=req.headers.authorization?.replace(/^Bearer /,'');
  const role=matches(token,this.ownerToken??'')?'owner':matches(token,this.guestToken??'')?'guest':null;
  if(!role)return this.#json(res,401,{error:'请从插件重新打开控制台。'});
  if(req.method==='GET'&&url.pathname==='/api/view'&&!url.search){const value=await this.snapshot(role);if(role==='owner')this.ownerViewCount++;return this.#json(res,200,value);}
  if(req.method!=='POST'||url.pathname!=='/api/action'||url.search)return this.#json(res,404,{error:'不存在的操作。'});
  if(role!=='owner')return this.#json(res,403,{error:'访客只能查看公开概况。'});
  if(req.headers.origin!==this.origin||req.headers['content-type']!=='application/json')return this.#json(res,403,{error:'请在控制台内操作。'});
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768)return this.#json(res,413,{error:'内容太长。'});chunks.push(chunk);}const raw=Buffer.concat(chunks).toString('utf8');
  let args;try{args=JSON.parse(raw);}catch{return this.#json(res,400,{error:'操作格式无效。'});}
  const fields={guest_preview:[],start_replies:[],pause:[],remember_note:['text'],refresh_billing:[],check_browser:[],open_browser:[],scan_conversations:[],save_replies:['changes'],save_persona:['changes'],save_video:['changes'],start_plugin:['mode']};
  if(!args||typeof args!=='object'||Array.isArray(args)||!Object.hasOwn(fields,args.action)||Object.keys(args).some(k=>k!=='action'&&!fields[args.action].includes(k)))return this.#json(res,400,{error:'操作格式无效。'});
  if(['save_replies','save_persona','save_video'].includes(args.action)&&(!args.changes||typeof args.changes!=='object'||Array.isArray(args.changes)||!Object.keys(args.changes).length))return this.#json(res,400,{error:'设置格式无效。'});
  if(args.action==='start_plugin'&&!['replies','watch_only','videos'].includes(args.mode))return this.#json(res,400,{error:'请选择运行模式。'});
  if(args.action==='guest_preview')return this.#json(res,200,{allowed:true,url:this.origin+'/#access='+this.guestToken});
  if(typeof this.commands[args.action]!=='function')return this.#json(res,409,{error:'当前为查看模式，请从 DSH 插件打开控制台后操作。'});
  if(args.action==='remember_note'&&(typeof args.text!=='string'||!args.text.trim()||[...args.text].length>160))return this.#json(res,400,{error:'记忆请输入 1–160 个字。'});
  const result=await this.commands[args.action](args);return this.#json(res,200,result);
 }
}

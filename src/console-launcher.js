import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {windowsPaths} from './windows-paths.js';

export const CONSOLE_LAUNCH_PATH='/api/douyin-fish/console-open';
export function validatedConsoleUrl(value){
 const url=new URL(value);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||!/^#access=[a-f0-9]{64}$/.test(url.hash))throw Error('Invalid local console URL');
 return url.href;
}
export async function openConsoleBrowser(value,{platform=process.platform,env=process.env,canAccess=access,spawnProcess=spawn}={}){
 const url=validatedConsoleUrl(value);
 let command=platform==='darwin'?'/usr/bin/open':'xdg-open',args=[url],waitForExit=false;
 if(platform==='win32'){
  const paths=windowsPaths(env);let edge;
  for(const candidate of paths.edgeCandidates){try{await canAccess(candidate);edge=candidate;break;}catch{}}
  if(edge){command=edge;args=['--new-window',url];}
  else{
   command=paths.powershell;waitForExit=true;
   const script="$ErrorActionPreference='Stop'; Start-Process -FilePath $env:DSH_FISH_CONSOLE_URL";
   args=['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];
  }
 }
 await new Promise((resolve,reject)=>{
  const child=spawnProcess(command,args,{detached:!waitForExit,windowsHide:waitForExit,stdio:'ignore',env:{...env,DSH_FISH_CONSOLE_URL:url}});
  child.once('error',reject);
  if(waitForExit){const timer=setTimeout(()=>{child.kill();reject(Error('Browser launch timed out'));},15000);child.once('error',()=>clearTimeout(timer));child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Browser association failed'));});}
  else child.once('spawn',()=>{child.unref();resolve();});
 });
}
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export function consoleLaunchRoute(dashboard,{openBrowser=openConsoleBrowser,now=Date.now}={}){
 let pending,last=null;
 return {path:CONSOLE_LAUNCH_PATH,methods:['POST'],requestBody:'buffered',async fetch(request){
  if(request.method!=='POST')return json(405,{allowed:false});
  if(new URL(request.url).search||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return json(400,{allowed:false});
  const reader=request.body?.getReader();let size=0,text='';
  try{
   if(!reader)return json(400,{allowed:false});
   const decoder=new TextDecoder();
   for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>128){await reader.cancel();return json(413,{allowed:false});}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();
   const args=JSON.parse(text);if(!args||Array.isArray(args)||Object.keys(args).length!==1||args.intent!=='open_console')return json(400,{allowed:false});
  }catch{return json(400,{allowed:false});}finally{reader?.releaseLock();}
  if(request.signal.aborted)return json(409,{allowed:false});
  pending??=(async()=>{
   const opened=await dashboard.open(),url=validatedConsoleUrl(opened.url);
   if(last?.url===url&&now()-last.at<3000)return {allowed:true,opened:true,url,reused:true};
   try{await openBrowser(url);last={url,at:now()};return {allowed:true,opened:true,url};}
   catch{return {allowed:true,opened:false,url,reason:'browser_open_failed'};}
  })().finally(()=>{pending=null;});
  try{return json(200,await pending);}catch{return json(503,{allowed:false,reason:'console_open_failed'});}
 }};
}
export function installConsoleLauncher(ctx,dashboard){
 // Connection owns authentication and rejects all non-owner peers for exact routes.
 // Registration alone opens no window and starts neither console nor model activity.
 if(typeof ctx.inject==='function')ctx.inject(['connection'],scope=>{
  if(typeof scope.connection?.fetch?.register==='function')scope.connection.fetch.register(consoleLaunchRoute(dashboard));
 });
}

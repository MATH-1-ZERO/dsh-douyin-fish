import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {consoleLaunchRoute,validatedConsoleUrl,installConsoleLauncher} from '../../src/console-launcher.js';
const url='http://127.0.0.1:12345/#access='+'a'.repeat(64);
const request=(body={intent:'open_console'},init={})=>new Request('http://localhost/api/douyin-fish/console-open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...init});
test('launcher accepts only generated local console URLs',()=>{
 assert.equal(validatedConsoleUrl(url),url);
 for(const bad of ['https://evil.invalid/','http://localhost:12345/#access='+'a'.repeat(64),url.replace('/#','/other#'),url.replace('/#','/?next=evil#'),url.replace('127.0.0.1','secret@127.0.0.1'),url.replace('a'.repeat(64),'oops'),'file:///C:/Windows/System32/cmd.exe'])assert.throws(()=>validatedConsoleUrl(bad));
});
test('registration is lazy and uses the owner-authenticated connection route',()=>{
 let route,opened=0;installConsoleLauncher({inject(keys,setup){assert.deepEqual(keys,['connection']);setup({connection:{fetch:{register(value){route=value;}}}});}}, {open(){opened++;}});
 assert.equal(route.path,'/api/douyin-fish/console-open');assert.deepEqual(route.methods,['POST']);assert.equal(opened,0);
});
test('malformed or oversized launch requests never open a console or browser',async()=>{
 let opened=0;const route=consoleLaunchRoute({open:async()=>{opened++;return {url};}},{openBrowser:async()=>{opened++;}});
 for(const req of [request({url}),request({intent:'open_console',url}),request({intent:'start_replies'}),request(null),request({intent:'x'.repeat(150)}),request({}, {headers:{'Content-Type':'text/plain'}})])assert.ok((await route.fetch(req)).status>=400);
 assert.equal((await route.fetch(new Request('http://localhost/api/douyin-fish/console-open'))).status,405);assert.equal(opened,0);
});
test('simultaneous menu gestures launch once, and a new console token is never replaced by a stale link',async()=>{
 let launches=0,current=url;const route=consoleLaunchRoute({open:async()=>({url:current})},{openBrowser:async value=>{assert.equal(value,current);launches++;},now:()=>100});
 const [a,b]=await Promise.all([route.fetch(request()),route.fetch(request())]);assert.equal((await a.json()).opened,true);assert.equal((await b.json()).url,url);assert.equal(launches,1);
 assert.equal((await(await route.fetch(request())).json()).reused,true);assert.equal(launches,1);
 current=url.replace('a'.repeat(64),'b'.repeat(64));assert.equal((await(await route.fetch(request())).json()).url,current);assert.equal(launches,2);
});
test('browser failure offers the validated console link without exposing errors or starting automation',async()=>{
 const route=consoleLaunchRoute({open:async()=>({url})},{openBrowser:async()=>{throw Error('private host details');}});
 const res=await route.fetch(request()),data=await res.json();assert.equal(res.status,200);assert.equal(data.opened,false);assert.equal(data.url,url);assert.ok(!JSON.stringify(data).includes('private'));
 const invalid=consoleLaunchRoute({open:async()=>({url:'https://evil.invalid'})},{openBrowser:async()=>assert.fail('no arbitrary URL')});assert.equal((await invalid.fetch(request())).status,503);
});
test('client bundle registers the settings entry without launching on plugin activation',async()=>{
 let loaded,registered,requests=0;
 runInNewContext(await readFile(new URL('../../src/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load(value){loaded=value;}}},fetch(){requests++;},URL});
 assert.equal(loaded.id,'@local/dsh-douyin-fish');const client=loaded.factory(name=>{assert.equal(name,'react');return {createElement(){}};});
 client.apply({slots:{inject(name,setup){assert.equal(name,'settings.section');return setup();},register(options,component){registered={options,component};}}});
 assert.equal(registered.options.id,'douyin-fish-console');assert.equal(registered.options.label,'大肥鱼控制台');assert.equal(typeof registered.component,'function');assert.equal(requests,0);
});

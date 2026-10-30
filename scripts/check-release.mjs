import {readdir,readFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
import assert from 'node:assert/strict';
import {validatePersona} from '../persona.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const ignored=new Set(['.git','node_modules','work','outputs','coverage','test-results']);
async function walk(folder){const found=[];for(const e of await readdir(folder,{withFileTypes:true})){if(ignored.has(e.name))continue;const p=join(folder,e.name);if(e.isSymbolicLink())throw Error('Unexpected symlink '+p);if(e.isDirectory())found.push(...await walk(p));else found.push(p);}return found;}
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
for(const file of pkg.files)await access(join(root,file));
const persona=validatePersona(JSON.parse(await readFile(join(root,'personas','蓝色鲸鱼娘.json'),'utf8')));
assert.equal(persona.ownerId,'');assert.deepEqual(persona.dmContacts,[]);assert.equal(persona.schedule.enabled,false);
const failures=[];let checked=0;
for(const path of await walk(root)){
 const name=relative(root,path).replaceAll('\\','/');
 if(/(^|\/)(?:state\.json|\.credentials\.yaml|\.retained-browser\.json|Cookies|Login Data|DevToolsActivePort)$/.test(name))failures.push(name+': private runtime file');
 if(!/\.(?:js|mjs|json|md|ps1|cmd|yml|html|css|svg)$/.test(name))continue;
 checked++;const text=await readFile(path,'utf8');
 if(/(?:[A-Z]:[\\/])(?:codex_code|deepseek)[\\/]/i.test(text))failures.push(name+': machine-specific path');
 if(/#access=[a-f0-9]{32,}/.test(text)||/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)||/gh[pousr]_[A-Za-z0-9]{30,}/.test(text))failures.push(name+': possible credential');
 // Release scripts and tests use placeholders; no saved platform user IDs.
 if(/MS4wLj[A-Za-z0-9_-]{30,}/.test(text))failures.push(name+': saved platform user identifier');
}
assert.deepEqual(failures,[],'Release privacy check failed');
console.log(JSON.stringify({version:pkg.version,checkedFiles:checked,privateRuntimeFilesIncluded:false,configuredOwner:false,scheduleEnabled:false,manifestPathsPresent:true}));

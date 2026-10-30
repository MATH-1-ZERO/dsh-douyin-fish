import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=[];
for(const directory of ['tests/unit','tests/browser'])for(const file of await readdir(new URL('../'+directory+'/',import.meta.url)))if(/\.test\.(?:js|mjs)$/.test(file))files.push(directory+'/'+file);
const child=spawn(process.execPath,['--test','--test-timeout=20000',...files],{cwd:root,stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.on('exit',code=>process.exitCode=code??1);

import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=(await readdir(root)).filter(f=>f.endsWith('.test.js'));
files.push(...(await readdir(new URL('../live-browser/',import.meta.url))).filter(f=>f.endsWith('.test.mjs')).map(f=>'live-browser/'+f));
const child=spawn(process.execPath,['--test','--test-timeout=20000',...files],{cwd:root,stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.on('exit',code=>process.exitCode=code??1);

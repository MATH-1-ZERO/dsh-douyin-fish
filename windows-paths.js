import {win32} from 'node:path';
export function windowsPaths(env=process.env){
 const system=env.SystemRoot||env.WINDIR||'C:\\Windows';
 const roots=[env['ProgramFiles(x86)'],env.ProgramFiles,env.LOCALAPPDATA,'C:\\Program Files (x86)','C:\\Program Files'].filter(Boolean);
 return {netstat:win32.join(system,'System32','netstat.exe'),powershell:win32.join(system,'System32','WindowsPowerShell','v1.0','powershell.exe'),
  edgeCandidates:[...new Set(roots.map(root=>win32.join(root,'Microsoft','Edge','Application','msedge.exe')))]};
}

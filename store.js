import { mkdir, open, readFile, rename, unlink, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { freshState, validateState } from './engine.js';

// A directory lock serializes all plugin instances sharing this data directory.
// Stale locks are never stolen automatically: crash recovery requires review.
export class JsonStore {
  constructor(directory) { this.directory = resolve(directory); }
  async snapshot(){
    try{return validateState(JSON.parse(await readFile(join(this.directory,'state.json'),'utf8')));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      try{await readFile(join(this.directory,'initialized'),'utf8');}
      catch(markerError){if(markerError.code==='ENOENT')return freshState();throw markerError;}
      throw Error('STATE_MISSING: refusing to reset initialized state');
    }
  }
  async transact(operation) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = join(this.directory, '.transaction-lock');
    try { await mkdir(lock); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('STATE_BUSY_OR_STALE_LOCK: do not reset state; review lock after stopping DSH');
      throw error;
    }
    let temp;
    try {
      const path = join(this.directory, 'state.json');
      let state;
      try { state = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try {
          await readFile(join(this.directory, 'initialized'), 'utf8');
          throw new Error('STATE_MISSING: refusing to reset previously initialized limits');
        } catch (markerError) {
          if (markerError.code !== 'ENOENT') throw markerError;
        }
        state = freshState();
      }
      validateState(state);
      const { state: next, value } = await operation(state);
      validateState(next);
      // A crash after this marker but before the first commit fails closed.
      try { await writeFile(join(this.directory, 'initialized'), '1\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      temp = join(this.directory, '.state-' + randomUUID() + '.tmp');
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(next, null, 2) + '\n', 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temp, path);
      temp = undefined;
      return value;
    } finally {
      try { if (temp) await unlink(temp); }
      finally { await rmdir(lock); }
    }
  }
}

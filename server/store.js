import { writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

export function writeSnapshot(directory, serialized, rename = renameSync) {
  const target = path.join(directory, 'snapshot.json');
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, serialized);
  // Windows scanners can briefly lock the destination. Preserve atomic rename;
  // never delete the previous good snapshot to work around a lock.
  for (let attempt = 0; ; attempt++) {
    try {
      rename(temporary, target);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
    }
  }
}

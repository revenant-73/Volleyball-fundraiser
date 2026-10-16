import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { storageCipher } from '../server/pilot/encryption.js';

const envFile = new URL('../.env.pilot', import.meta.url);
const keyFile = new URL('../.local/pilot/storage-recovery-key-v1.json', import.meta.url);
const prior = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, 'utf8')) : null;
const key = process.env.RALLYFUND_STORAGE_KEY || prior?.key || randomBytes(32).toString('base64');
const cipher = storageCipher(key);
if (prior && prior.key !== key)
  throw new Error('Stored recovery key and pilot configuration differ. Refusing to rotate.');
mkdirSync(new URL('../.local/pilot/', import.meta.url), { recursive: true });
if (!prior)
  writeFileSync(
    keyFile,
    JSON.stringify(
      {
        version: 1,
        site: 'rallyfund-tvvc-pilot',
        keyId: cipher.keyId,
        key,
        note: 'Keep a secure offline copy. This key decrypts private media and cloud backups; never commit or share it.',
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
const contents = readFileSync(envFile, 'utf8');
if (!process.env.RALLYFUND_STORAGE_KEY) {
  const updated = /^RALLYFUND_STORAGE_KEY=.*$/m.test(contents)
    ? contents.replace(/^RALLYFUND_STORAGE_KEY=.*$/m, `RALLYFUND_STORAGE_KEY=${key}`)
    : contents.trimEnd() + `\nRALLYFUND_STORAGE_KEY=${key}\n`;
  const temporary = new URL('../.env.pilot.tmp', import.meta.url);
  writeFileSync(temporary, updated, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, envFile);
}
process.env.RALLYFUND_STORAGE_KEY = key;
await import('./configure-pilot-host.mjs');
if (!process.exitCode)
  console.log(
    'Storage recovery key saved privately in .local/pilot/storage-recovery-key-v1.json. Keep a secure offline copy.',
  );

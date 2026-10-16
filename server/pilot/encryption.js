import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import { hash } from '../domain.js';

export function storageCipher(encodedKey) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey || ''))
    throw new Error('A 32-byte storage recovery key is required.');
  const key = Buffer.from(encodedKey, 'base64');
  const keyId = hash(key.toString('hex')).slice(0, 16);
  const derived = (purpose) =>
    Buffer.from(hkdfSync('sha256', key, 'rallyfund-tvvc-pilot', purpose, 32));
  return {
    keyId,
    seal(value, purpose, identity) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', derived(purpose), iv);
      cipher.setAAD(Buffer.from(`${purpose}:${identity}`));
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(value)), cipher.final()]);
      return JSON.stringify({
        version: 1,
        keyId,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      });
    },
    open(envelope, purpose, identity) {
      const parsed = JSON.parse(String(envelope));
      if (parsed.version !== 1 || parsed.keyId !== keyId)
        throw new Error('Storage recovery key does not match.');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        derived(purpose),
        Buffer.from(parsed.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(`${purpose}:${identity}`));
      decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
        decipher.final(),
      ]);
    },
  };
}

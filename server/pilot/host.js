import { getStore } from '@netlify/blobs';
import { createClient } from '@libsql/client/web';
import { validatePilotUrl } from './store.js';
import { storageCipher } from './encryption.js';
import { mediaService } from './media.js';
import { cloudBackupService } from './cloud-backup.js';

export const PILOT_SITE = '042b91a6-50e0-4f18-9d67-0ca7f789cfa9';
export const PILOT_ORIGIN = 'https://rallyfund-tvvc-pilot.netlify.app';
export const MEDIA_STORE = 'rallyfund-pilot-private-media-v1';
export const BACKUP_STORE = 'rallyfund-pilot-encrypted-backups-v1';
let client;

export function assertPilotContext({ mode, origin, context, requestOrigin }) {
  if (
    mode !== 'pilot' ||
    origin !== PILOT_ORIGIN ||
    context.site?.id !== PILOT_SITE ||
    context.deploy?.context !== 'production' ||
    context.deploy?.published === false ||
    new URL(context.site.url.replace(/^http:/, 'https:')).origin !== PILOT_ORIGIN ||
    (requestOrigin && requestOrigin !== PILOT_ORIGIN)
  )
    throw new Error('Pilot production context required.');
}

export function hostedPilotResources(context, requestOrigin) {
  const env = (key) => Netlify.env.get(key);
  assertPilotContext({
    mode: env('RALLYFUND_MODE'),
    origin: env('RALLYFUND_PILOT_ORIGIN'),
    context,
    requestOrigin,
  });
  const authToken = env('RALLYFUND_TURSO_AUTH_TOKEN');
  if (!authToken) throw new Error('Missing pilot database credentials.');
  client ||= createClient({
    url: validatePilotUrl(env('RALLYFUND_TURSO_DATABASE_URL')),
    authToken,
  });
  const cipher = storageCipher(env('RALLYFUND_STORAGE_KEY'));
  const mediaStore = getStore({ name: MEDIA_STORE, consistency: 'strong' });
  const backupStore = getStore({ name: BACKUP_STORE, consistency: 'strong' });
  return {
    client,
    cipher,
    mediaStore,
    backupStore,
    services: {
      media: mediaService({ store: mediaStore, cipher }),
      backups: cloudBackupService({ backupStore, mediaStore, cipher }),
    },
  };
}

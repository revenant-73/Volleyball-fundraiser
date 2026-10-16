import { randomUUID } from 'node:crypto';
import { hash } from '../domain.js';
import { mediaKey, imageHash } from './media.js';
import { restorePilotToEmpty } from './backup.js';

export function backupId(value) {
  if (!/^(daily-\d{4}-\d{2}-\d{2}|manual-[A-Za-z0-9_-]{8,100})$/.test(value || ''))
    throw new Error('Invalid backup ID.');
  return value;
}
export const backupKey = (id) => `backups/${backupId(id)}.enc`;
const receiptKey = (id) => `verified/${backupId(id)}.json`;
const maxBundleBytes = 12 * 1024 * 1024;

export function readBundle(envelope, id, cipher) {
  const buffer = cipher.open(envelope, 'backup', backupKey(id));
  if (buffer.length > maxBundleBytes)
    throw new Error('Backup exceeds the preparation recovery limit.');
  const bundle = JSON.parse(buffer.toString());
  const backup = bundle.databaseBackup;
  if (
    bundle.version !== 1 ||
    backup?.database !== 'rallyfund-tvvc-pilot' ||
    hash(JSON.stringify(backup.snapshot)) !== backup.checksum
  )
    throw new Error('Backup integrity check failed.');
  const assets = backup.snapshot.state.mediaAssets || [];
  if (!Array.isArray(bundle.media) || bundle.media.length !== assets.length)
    throw new Error('Incomplete media backup.');
  for (const asset of assets) {
    const key = mediaKey(asset),
      entries = bundle.media.filter((entry) => entry.key === key);
    if (
      entries.length !== 1 ||
      imageHash(cipher.open(entries[0].envelope, 'media', key)) !== asset.checksum
    )
      throw new Error('Backup media integrity check failed.');
  }
  return bundle;
}

export function cloudBackupService({ backupStore, mediaStore, cipher, now = () => new Date() }) {
  return {
    async run(databaseBackup, { requestId } = {}) {
      const time = now();
      // A 12:00 UTC daily boundary, with hourly checks to retry transient failures.
      const slot = new Date(time.getTime() - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const id = backupId(requestId ? `manual-${requestId}` : `daily-${slot}`);
      const key = backupKey(id);
      try {
        let envelope = await backupStore.get(key);
        if (envelope === null) {
          const assets = databaseBackup.snapshot.state.mediaAssets || [];
          const media = [];
          // Bounded parallel reads keep large photo libraries inside function limits.
          for (let i = 0; i < assets.length; i += 6) {
            const batch = await Promise.all(
              assets.slice(i, i + 6).map(async (asset) => {
                const mediaObjectKey = mediaKey(asset),
                  value = await mediaStore.get(mediaObjectKey);
                if (
                  value === null ||
                  imageHash(cipher.open(value, 'media', mediaObjectKey)) !== asset.checksum
                )
                  throw new Error('An image is missing or damaged; backup not verified.');
                return { key: mediaObjectKey, envelope: value };
              }),
            );
            media.push(...batch);
          }
          const value = JSON.stringify({ version: 1, databaseBackup, media });
          if (Buffer.byteLength(value) > maxBundleBytes)
            throw new Error('Backup exceeds the preparation size limit.');
          const candidate = cipher.seal(value, 'backup', key);
          await backupStore.set(key, candidate, { onlyIfNew: true });
          envelope = await backupStore.get(key);
        }
        const verified = readBundle(envelope, id, cipher);
        const receipt = {
          id,
          createdAt: verified.databaseBackup.createdAt,
          verifiedAt: time.toISOString(),
          keyId: cipher.keyId,
          mediaCount: verified.media.length,
          checksum: verified.databaseBackup.checksum,
          bytes: Buffer.byteLength(envelope),
        };
        await backupStore.set(receiptKey(id), JSON.stringify(receipt), { onlyIfNew: true });
        return JSON.parse(await backupStore.get(receiptKey(id)));
      } catch (error) {
        // Store only an operational signal, never provider errors or data.
        await backupStore
          .set(
            `failures/${time.toISOString().replaceAll(':', '-')}-${randomUUID()}.json`,
            JSON.stringify({ at: time.toISOString(), reason: 'Backup did not verify' }),
            { onlyIfNew: true },
          )
          .catch(() => {});
        throw error;
      }
    },
    async status() {
      const { blobs } = await backupStore.list({ prefix: 'verified/' });
      const receipts = await Promise.all(
        blobs.map(async ({ key }) => JSON.parse(await backupStore.get(key))),
      );
      receipts.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
      const { blobs: failures } = await backupStore.list({ prefix: 'failures/' });
      const failureKey = failures
        .map(({ key }) => key)
        .sort()
        .at(-1);
      const lastFailure = failureKey ? JSON.parse(await backupStore.get(failureKey)).at : null;
      return {
        backups: receipts,
        lastFailure,
        failureActive: !!lastFailure && (!receipts.length || lastFailure > receipts[0].verifiedAt),
        stale:
          !receipts.length ||
          now().getTime() - Date.parse(receipts[0].createdAt) > 36 * 60 * 60 * 1000,
        schedule: 'Daily at 12:00 UTC, with hourly retry checks',
        retention: 'No automatic deletion; retention policy pending',
      };
    },
    async download(id) {
      const value = await backupStore.get(backupKey(id));
      if (value === null) throw new Error('Backup not found.');
      readBundle(value, id, cipher);
      return value;
    },
  };
}

export async function restoreCloudBackupToEmpty({ client, mediaStore, envelope, id, cipher }) {
  const bundle = readBundle(envelope, id, cipher);
  if ((await mediaStore.list()).blobs.length)
    throw new Error('Recovery requires an empty media destination.');
  // restorePilotToEmpty independently refuses any nonempty database.
  const result = await restorePilotToEmpty(client, bundle.databaseBackup);
  for (const entry of bundle.media) {
    await mediaStore.set(entry.key, entry.envelope, { onlyIfNew: true });
    const saved = await mediaStore.get(entry.key);
    if (saved !== entry.envelope) throw new Error('Recovered media differs from the backup.');
  }
  return { ...result, mediaCount: bundle.media.length };
}

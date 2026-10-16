import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createClient } from '@libsql/client';
import { storageCipher } from '../server/pilot/encryption.js';
import { mediaService, normalizeImage, mediaKey } from '../server/pilot/media.js';
import {
  cloudBackupService,
  restoreCloudBackupToEmpty,
  backupKey,
} from '../server/pilot/cloud-backup.js';
import { assertPilotContext, PILOT_SITE, PILOT_ORIGIN } from '../server/pilot/host.js';
import { migratePilot, transactPilot } from '../server/pilot/store.js';
import { addAdmin, createPilotState } from '../server/pilot/admin.js';
import { exportPilot, restorePilotToEmpty } from '../server/pilot/backup.js';
import { createPilotHandler } from '../server/pilot/handler.js';
import { hash } from '../server/domain.js';

export function memoryStore() {
  const values = new Map();
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value, { onlyIfNew = false } = {}) {
      if (onlyIfNew && values.has(key)) return { modified: false };
      values.set(key, String(value));
      return { modified: true };
    },
    async list({ prefix = '' } = {}) {
      return {
        blobs: [...values.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      };
    },
  };
}
function emptyClient(t) {
  const directory = mkdtempSync(path.resolve('.local-test-pilot-'));
  const client = createClient({ url: `file:${path.join(directory, 'storage.db')}` });
  t.after(() => client.close());
  return client;
}
async function setup(t) {
  const client = emptyClient(t);
  await migratePilot(client);
  let user;
  await transactPilot(client, ({ state }) => {
    user = addAdmin(
      state,
      { orgId: 'tvvc', role: 'owner', userId: 'bootstrap' },
      { email: 'owner@example.test', password: 'fictional-owner-password', role: 'owner' },
    );
  });
  const actor = { userId: user.id, orgId: 'tvvc', role: 'owner' };
  const cipher = storageCipher(randomBytes(32).toString('base64'));
  const mediaStore = memoryStore(),
    backupStore = memoryStore();
  const media = mediaService({ store: mediaStore, cipher });
  const clock = { value: new Date('2026-10-16T15:00:00Z') };
  const backups = cloudBackupService({ backupStore, mediaStore, cipher, now: () => clock.value });
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#39c6b0' } })
    .png()
    .toBuffer();
  const input = {
    purpose: 'organization-logo',
    contentType: 'image/png',
    base64: png.toString('base64'),
    requestId: 'synthetic-upload-001',
  };
  return { client, actor, cipher, mediaStore, backupStore, media, backups, input, clock };
}

test('private images decode, resize and strip metadata; malformed, mismatched, oversized and vector uploads are rejected', async () => {
  const jpeg = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: '#39c6b0' },
  })
    .withMetadata({ exif: { IFD0: { Artist: 'Fictional metadata only' } } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(jpeg).metadata()).exif);
  const image = await normalizeImage({
    contentType: 'image/jpeg',
    base64: jpeg.toString('base64'),
  });
  const result = await sharp(image.data).metadata();
  assert.equal(result.format, 'webp');
  assert.equal(result.width, 1600);
  assert.equal(result.exif, undefined);
  assert.equal(result.icc, undefined);
  for (const input of [
    { contentType: 'image/svg+xml', base64: Buffer.from('<svg/>').toString('base64') },
    { contentType: 'image/png', base64: jpeg.toString('base64') },
    { contentType: 'image/png', base64: Buffer.from('not an image').toString('base64') },
    { contentType: 'image/png', base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') },
  ])
    await assert.rejects(normalizeImage(input));
  const tooWide = await sharp({
    create: { width: 9000, height: 2, channels: 3, background: '#39c6b0' },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    normalizeImage({ contentType: 'image/png', base64: tooWide.toString('base64') }),
  );
});

test('private media upload is durable and idempotent, organization-scoped and revocable without deleting recovery copies', async (t) => {
  const s = await setup(t);
  let asset;
  await transactPilot(s.client, async ({ state }) => {
    asset = await s.media.upload(state, s.actor, s.input);
  });
  await transactPilot(s.client, async ({ state }) => {
    assert.equal((await s.media.upload(state, s.actor, s.input)).id, asset.id);
    await assert.rejects(s.media.upload(state, s.actor, { ...s.input, purpose: 'athlete-photo' }), {
      status: 409,
    });
    assert.equal(state.mediaAssets.length, 1);
    assert.equal(s.mediaStore.values.size, 1);
    const data = await s.media.read(state, s.actor, asset.id);
    assert.equal((await sharp(data).metadata()).format, 'webp');
    await assert.rejects(s.media.read(state, { orgId: 'other' }, asset.id), { status: 404 });
    const stored = [...s.mediaStore.values.values()][0];
    assert.equal(stored.includes(s.input.base64), false);
    s.media.hide(state, s.actor, asset.id);
    s.media.hide(state, s.actor, asset.id);
    assert.equal(state.adminAudit.filter((a) => a.action === 'media-hidden').length, 1);
    await assert.rejects(s.media.read(state, s.actor, asset.id), { status: 404 });
  });
  await transactPilot(s.client, ({ state }) => assert.equal(state.mediaAssets[0].status, 'hidden'));
  assert.equal(s.mediaStore.values.size, 1);
});

test('encrypted backups include media, survive replay and recover both database and files without resurrecting sessions', async (t) => {
  const s = await setup(t);
  await transactPilot(s.client, async ({ state, auth }) => {
    await s.media.upload(state, s.actor, s.input);
    auth.sessions.push([
      'hashed-session',
      { userId: s.actor.userId, orgId: 'tvvc', expires: Date.now() + 60000, credentialVersion: 1 },
    ]);
  });
  const backup = await exportPilot(s.client);
  const first = await s.backups.run(backup),
    replay = await s.backups.run(await exportPilot(s.client));
  assert.equal(first.id, 'daily-2026-10-16');
  assert.equal(replay.checksum, first.checksum);
  assert.equal((await s.backups.status()).backups.length, 1);
  const envelope = await s.backups.download(first.id);
  assert.equal(envelope.includes('owner@example.test'), false);
  assert.equal(envelope.includes('passwordHash'), false);
  const target = emptyClient(t),
    destination = memoryStore();
  const restored = await restoreCloudBackupToEmpty({
    client: target,
    mediaStore: destination,
    envelope,
    id: first.id,
    cipher: s.cipher,
  });
  assert.equal(restored.integrity, 'ok');
  assert.equal(restored.mediaCount, 1);
  await transactPilot(target, async ({ state, auth }) => {
    assert.equal(auth.sessions.length, 0);
    assert.equal(
      (
        await mediaService({ store: destination, cipher: s.cipher }).read(
          state,
          s.actor,
          state.mediaAssets[0].id,
        )
      ).length,
      state.mediaAssets[0].bytes,
    );
  });
  const damaged = JSON.parse(envelope);
  damaged.ciphertext = (damaged.ciphertext[0] === 'A' ? 'B' : 'A') + damaged.ciphertext.slice(1);
  await assert.rejects(
    restoreCloudBackupToEmpty({
      client: emptyClient(t),
      mediaStore: memoryStore(),
      envelope: JSON.stringify(damaged),
      id: first.id,
      cipher: s.cipher,
    }),
  );
  await assert.rejects(
    restoreCloudBackupToEmpty({
      client: emptyClient(t),
      mediaStore: memoryStore(),
      envelope,
      id: first.id,
      cipher: storageCipher(randomBytes(32).toString('base64')),
    }),
  );
  await assert.rejects(
    restoreCloudBackupToEmpty({
      client: emptyClient(t),
      mediaStore: memoryStore(),
      envelope,
      id: 'daily-2026-10-17',
      cipher: s.cipher,
    }),
  );
  s.clock.value = new Date('2026-10-18T15:00:00Z');
  assert.equal((await s.backups.status()).stale, true);
});

test('failed or incomplete backups never replace a verified backup; failures are visible and retries can recover', async (t) => {
  const s = await setup(t);
  const first = await s.backups.run(await exportPilot(s.client));
  const original = s.backupStore.values.get(backupKey(first.id));
  await transactPilot(s.client, async ({ state }) => {
    await s.media.upload(state, s.actor, s.input);
  });
  const saved = [...s.mediaStore.values.entries()][0];
  s.mediaStore.values.clear();
  s.clock.value = new Date('2026-10-17T15:00:00Z');
  await assert.rejects(s.backups.run(await exportPilot(s.client)), /missing or damaged/);
  assert.equal((await s.backups.status()).failureActive, true);
  assert.equal(s.backupStore.values.get(backupKey(first.id)), original);
  s.mediaStore.values.set(...saved);
  s.clock.value = new Date('2026-10-17T16:00:00Z');
  await s.backups.run(await exportPilot(s.client));
  const status = await s.backups.status();
  assert.equal(status.backups.length, 2);
  assert.equal(status.failureActive, false);
});

test('legacy database-only recovery remains supported after the additive media migration', async (t) => {
  const legacy = createPilotState();
  delete legacy.state.mediaAssets;
  const backup = {
    database: 'rallyfund-tvvc-pilot',
    format: 1,
    snapshot: legacy,
    checksum: hash(JSON.stringify(legacy)),
    createdAt: new Date().toISOString(),
  };
  assert.equal((await restorePilotToEmpty(emptyClient(t), backup)).integrity, 'ok');
  const old = emptyClient(t);
  await old.executeMultiple(
    readFileSync(new URL('../server/pilot/schema.sql', import.meta.url), 'utf8'),
  );
  await old.execute("INSERT INTO pilot_metadata(id,version) VALUES ('rallyfund-tvvc-pilot',1)");
  await old.execute({
    sql: 'INSERT INTO organizations(id,data) VALUES (?,?)',
    args: ['tvvc', JSON.stringify(legacy.state.organizations[0])],
  });
  await migratePilot(old);
  await migratePilot(old);
  await transactPilot(old, ({ state }) => assert.deepEqual(state.mediaAssets, []));
});

test('private media and backups require a live org-scoped session; backup controls require owner reauthentication', async (t) => {
  const s = await setup(t),
    origin = 'https://pilot.example.test';
  let cookie = '';
  const call = (url, method = 'GET', body) =>
    createPilotHandler({ client: s.client, services: s, origins: [origin] })(
      new Request(origin + url, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Prototype': 'local',
          cookie,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  assert.equal((await call('/api/admin/media')).status, 401);
  const login = await call('/api/login', 'POST', {
    email: 'owner@example.test',
    password: 'fictional-owner-password',
  });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const uploaded = await call('/api/admin/media', 'POST', s.input);
  assert.equal(uploaded.status, 200);
  const asset = await uploaded.json();
  const image = await call(asset.url);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/webp/);
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format, 'webp');
  assert.equal(
    (
      await call('/api/admin/backups', 'POST', {
        currentPassword: 'wrong',
        requestId: 'manual-test-001',
      })
    ).status,
    401,
  );
  const manual = await call('/api/admin/backups', 'POST', {
    currentPassword: 'fictional-owner-password',
    requestId: 'manual-test-001',
  });
  assert.equal(manual.status, 200);
  const backup = await manual.json();
  assert.equal((await call(`/api/admin/backups/${backup.id}/download`)).status, 200);
  const ownerCookie = cookie;
  await transactPilot(s.client, ({ state }) => {
    state.organizations.push({ id: 'other', name: 'Fictional other organization' });
    addAdmin(
      state,
      { orgId: 'other', role: 'owner', userId: 'test-bootstrap' },
      { email: 'other@example.test', password: 'fictional-other-password', role: 'owner' },
    );
    addAdmin(state, s.actor, {
      email: 'coach@example.test',
      password: 'fictional-coach-password',
      role: 'admin',
    });
  });
  for (const credentials of [
    { email: 'other@example.test', password: 'fictional-other-password' },
    { email: 'coach@example.test', password: 'fictional-coach-password' },
  ]) {
    const signedIn = await call('/api/login', 'POST', credentials);
    assert.equal(signedIn.status, 200);
    cookie = signedIn.headers.get('set-cookie').split(';')[0];
    assert.equal((await call('/api/admin/backups')).status, 403);
    assert.equal((await call(`/api/admin/backups/${backup.id}/download`)).status, 403);
    if (credentials.email === 'other@example.test') {
      assert.equal((await call(asset.url)).status, 404);
      assert.deepEqual((await (await call('/api/admin/media')).json()).images, []);
    }
  }
  cookie = ownerCookie;
  await call('/api/logout', 'POST', {});
  assert.equal((await call(asset.url)).status, 401);
  assert.equal((await call('/api/public/anything')).status, 403);
});

test('an aborted upload transaction cannot expose an orphaned encrypted object', async (t) => {
  const s = await setup(t);
  let id;
  await assert.rejects(
    transactPilot(s.client, async ({ state }) => {
      id = (await s.media.upload(state, s.actor, s.input)).id;
      throw new Error('Synthetic commit interruption');
    }),
    /Synthetic/,
  );
  assert.equal(s.mediaStore.values.size, 1);
  await transactPilot(s.client, async ({ state }) => {
    assert.equal(state.mediaAssets.length, 0);
    await assert.rejects(s.media.read(state, s.actor, id), { status: 404 });
  });
});

test('review, preview, wrong host and unpublished contexts cannot open pilot cloud storage', () => {
  const valid = {
    mode: 'pilot',
    origin: PILOT_ORIGIN,
    requestOrigin: PILOT_ORIGIN,
    context: {
      site: { id: PILOT_SITE, url: PILOT_ORIGIN },
      deploy: { context: 'production', published: true },
    },
  };
  assert.doesNotThrow(() => assertPilotContext(valid));
  for (const changed of [
    { mode: 'review' },
    { requestOrigin: 'https://foreign.test' },
    { context: { ...valid.context, site: { id: 'review-site', url: PILOT_ORIGIN } } },
    { context: { ...valid.context, deploy: { context: 'deploy-preview', published: false } } },
  ])
    assert.throws(() => assertPilotContext({ ...valid, ...changed }));
});

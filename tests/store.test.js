import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { writeSnapshot } from '../server/store.js';
import { createApp } from '../server/app.js';
import { createSeed, hash } from '../server/domain.js';
function folder(t) {
  const directory = mkdtempSync(path.resolve('.local-test-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve('.') + path.sep + '.local-test-'));
    rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}
test('atomic snapshot retries a temporary Windows lock without deleting prior data', (t) => {
  const directory = folder(t);
  writeSnapshot(directory, '{"version":1}');
  let attempts = 0;
  writeSnapshot(directory, '{"version":2}', (source, target) => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error('Synthetic transient lock'), { code: 'EPERM' });
    renameSync(source, target);
  });
  assert.equal(attempts, 3);
  assert.equal(JSON.parse(readFileSync(path.join(directory, 'snapshot.json'))).version, 2);
});
test('persistent lock leaves previous snapshot intact and fails after bounded retries', (t) => {
  const directory = folder(t);
  writeSnapshot(directory, '{"version":1}');
  let attempts = 0;
  assert.throws(() =>
    writeSnapshot(directory, '{"version":2}', () => {
      attempts++;
      throw Object.assign(new Error('Synthetic persistent lock'), { code: 'EPERM' });
    }),
  );
  assert.equal(attempts, 6);
  assert.equal(JSON.parse(readFileSync(path.join(directory, 'snapshot.json'))).version, 1);
});
test('failed persistence rolls back both invitation hash and capability; restart reads previous snapshot', async (t) => {
  const directory = folder(t);
  let block = false;
  const { app, service } = createApp({
    directory,
    seed: createSeed('2026-10-10T12:00:00Z'),
    writeStore: (dir, data) => {
      if (block) throw Object.assign(new Error('Synthetic disk failure'), { code: 'ENOSPC' });
      writeSnapshot(dir, data);
    },
  });
  const c = service.state.campaigns.find((c) => c.orgId === 'tvvc');
  const athlete = service.state.athletes.find((a) => a.campaignId === c.id);
  const originalHash = athlete.inviteHash;
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Prototype': 'local' };
  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'coach@tvvc.example', password: 'prototype-only' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const before = hash(readFileSync(path.join(directory, 'snapshot.json'), 'utf8'));
  block = true;
  const failed = await fetch(`${base}/api/admin/campaigns/${c.id}/athletes/${athlete.id}/invite`, {
    method: 'POST',
    headers: { ...headers, cookie },
    body: '{}',
  });
  assert.equal(failed.status, 500);
  assert.equal(service.state.athletes.find((a) => a.id === athlete.id).inviteHash, originalHash);
  assert.equal(hash(readFileSync(path.join(directory, 'snapshot.json'), 'utf8')), before);
  const restarted = createApp({ directory });
  assert.equal(
    restarted.service.state.athletes.find((a) => a.id === athlete.id).inviteHash,
    originalHash,
  );
});

import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { createPilotState, normalizeEmail } from './admin.js';

export const PILOT_ID = 'rallyfund-tvvc-pilot';
const field = (column, key = column) => ({ column, key });
const org = field('org_id', 'orgId');
const campaign = field('campaign_id', 'campaignId');
// Indexed, constrained fields live in columns. Only the remaining domain
// configuration is JSON; no database-wide snapshot is stored in the pilot.
const specs = [
  ['organizations', 'organizations', []],
  [
    'users',
    'users',
    [
      org,
      field('email'),
      field('role'),
      field('active'),
      field('credential_version', 'credentialVersion'),
      field('salt'),
      field('password_hash', 'passwordHash'),
    ],
  ],
  [
    'campaigns',
    'campaigns',
    [org, field('slug'), field('status'), field('goal_cents', 'goalCents')],
  ],
  ['athletes', 'athletes', [org, campaign]],
  ['contacts', 'contacts', [org, campaign, field('email')]],
  [
    'donations',
    'ledger',
    [
      org,
      campaign,
      field('reference'),
      field('email'),
      field('amount_cents', 'amountCents'),
      field('fee_cents', 'feeCents'),
      field('method'),
      field('status'),
    ],
  ],
  [
    'jobs',
    'jobs',
    [
      campaign,
      field('contact_id', 'contactId'),
      field('donation_id', 'donationId'),
      field('type'),
      field('status'),
    ],
  ],
  ['activity', 'activity', [campaign]],
  ['ledger_audit', 'audit', [campaign, field('donation_id', 'donationId')]],
  ['admin_audit', 'adminAudit', [org]],
  [
    'media_assets',
    'mediaAssets',
    [
      org,
      campaign,
      field('athlete_id', 'athleteId'),
      field('created_by', 'createdBy'),
      field('status'),
      field('request_id', 'requestId'),
      field('fingerprint'),
    ],
  ],
];

export async function migratePilot(client) {
  const tx = await client.transaction('write');
  try {
    const tables = (
      await tx.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
    ).rows.map((r) => r.name);
    if (tables.includes('pilot_metadata')) {
      await assertPilot(tx);
    } else {
      if (tables.length)
        throw new Error('Pilot initialization requires an empty, dedicated database.');
      await tx.executeMultiple(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
      await tx.execute({
        sql: 'INSERT INTO pilot_metadata(id,version) VALUES (?,1)',
        args: [PILOT_ID],
      });
    }
    if (!tables.includes('media_assets'))
      await tx.executeMultiple(
        await readFile(new URL('./media-schema.sql', import.meta.url), 'utf8'),
      );
    if (!tables.includes('pilot_metadata'))
      await savePilot(tx, createPilotState(), createPilotState(), true);
    await tx.commit();
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    tx.close();
  }
}
async function assertPilot(tx) {
  if ((await tx.execute('PRAGMA foreign_keys')).rows[0].foreign_keys !== 1)
    throw new Error('Pilot database requires foreign key enforcement.');
  const rows = (await tx.execute('SELECT id,version FROM pilot_metadata')).rows;
  if (rows.length !== 1 || rows[0].id !== PILOT_ID || rows[0].version !== 1)
    throw new Error('Unexpected pilot database identity or schema version.');
}

async function loadPilot(tx) {
  const result = createPilotState();
  const extra = [
    'contact_athletes',
    'suppressions',
    'idempotency_requests',
    'payment_events',
    'private_links',
    'sessions',
    'login_attempts',
  ];
  const tables = [...specs.map(([table]) => table), ...extra];
  const rows = await tx.batch(tables.map((table) => `SELECT * FROM ${table} ORDER BY rowid`));
  const data = Object.fromEntries(tables.map((table, i) => [table, rows[i].rows]));
  for (const [table, key, fields] of specs) {
    result.state[key] = data[table].map((row) => ({
      ...(row.data ? JSON.parse(row.data) : {}),
      id: row.id,
      ...Object.fromEntries(
        fields
          .filter(({ key }) => key !== 'donationId' || row.donation_id !== null)
          .map(({ column, key }) => [key, key === 'active' ? Boolean(row[column]) : row[column]]),
      ),
    }));
  }
  for (const contact of result.state.contacts)
    contact.athleteIds = data.contact_athletes
      .filter((r) => r.contact_id === contact.id)
      .map((r) => r.athlete_id);
  result.state.suppressions = data.suppressions.map((r) => ({
    ...JSON.parse(r.data),
    orgId: r.org_id,
    email: r.email,
  }));
  result.state.requests = Object.fromEntries(
    data.idempotency_requests.map((r) => [r.id, JSON.parse(r.data)]),
  );
  result.state.events = Object.fromEntries(data.payment_events.map((r) => [r.id, r.fingerprint]));
  result.links = Object.fromEntries(data.private_links.map((r) => [r.athlete_id, r.capability]));
  result.auth.sessions = data.sessions.map((r) => [r.id, JSON.parse(r.data)]);
  result.auth.attempts = data.login_attempts.map((r) => [r.id, JSON.parse(r.data)]);
  return result;
}

async function savePilot(tx, before, after, initializing = false) {
  const statements = [];
  const upsert = (table, columns, values, conflict = ['id']) => {
    const updates = columns.filter((c) => !conflict.includes(c));
    statements.push({
      sql: `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(${conflict.join(',')}) DO UPDATE SET ${updates.map((c) => `${c}=excluded.${c}`).join(',')}`,
      args: values,
    });
  };
  for (const [table, key, fields] of specs) {
    const old = new Map(before.state[key].map((row) => [row.id, row]));
    if (
      !initializing &&
      before.state[key].some((row) => !after.state[key].some((r) => row.id === r.id))
    )
      throw new Error('Core record deletion requires a dedicated retention workflow.');
    for (const row of after.state[key]) {
      if (!initializing && isDeepStrictEqual(old.get(row.id), row)) continue;
      const data = { ...row };
      delete data.id;
      fields.forEach(({ key }) => delete data[key]);
      if (key === 'contacts') delete data.athleteIds;
      const columns = ['id', ...fields.map((f) => f.column)];
      const values = [
        row.id,
        ...fields.map(({ key }) => (key === 'active' ? Number(row[key]) : (row[key] ?? null))),
      ];
      if (table === 'donations') {
        columns.push('transaction_key');
        values.push(normalizeEmail(row.transaction));
      }
      if (table !== 'users') {
        columns.push('data');
        values.push(JSON.stringify(data));
      }
      upsert(table, columns, values);
    }
  }
  // Private capabilities and sessions may be revoked; core financial/contact
  // records and immutable event/request identities are never bulk-replaced.
  const sync = (table, prior, current, columns, toValues, conflict = ['id'], removable = false) => {
    const prev = new Map(prior),
      next = new Map(current);
    for (const [key, value] of next)
      if (!isDeepStrictEqual(prev.get(key), value)) {
        if (prev.has(key) && !removable) throw new Error('Immutable idempotency record changed.');
        upsert(table, columns, toValues(key, value), conflict);
      }
    for (const [key] of prev)
      if (!next.has(key)) {
        if (!removable) throw new Error('Immutable record removed.');
        statements.push({ sql: `DELETE FROM ${table} WHERE ${conflict[0]}=?`, args: [key] });
      }
  };
  for (const contact of after.state.contacts) {
    const previous = before.state.contacts.find((r) => r.id === contact.id)?.athleteIds || [];
    if (previous.some((id) => !contact.athleteIds.includes(id)))
      throw new Error('Contact association deletion requires a retention workflow.');
    for (const athleteId of contact.athleteIds)
      if (!previous.includes(athleteId))
        statements.push({
          sql: 'INSERT INTO contact_athletes(contact_id,athlete_id,campaign_id) VALUES (?,?,?)',
          args: [contact.id, athleteId, contact.campaignId],
        });
  }
  for (const row of after.state.suppressions) {
    const prior = before.state.suppressions.find(
      (r) => r.orgId === row.orgId && r.email === row.email,
    );
    if (isDeepStrictEqual(prior, row)) continue;
    const { orgId, email, ...data } = row;
    upsert(
      'suppressions',
      ['org_id', 'email', 'data'],
      [orgId, email, JSON.stringify(data)],
      ['org_id', 'email'],
    );
  }
  sync(
    'idempotency_requests',
    Object.entries(before.state.requests),
    Object.entries(after.state.requests),
    ['id', 'data'],
    (k, v) => [k, JSON.stringify(v)],
  );
  sync(
    'payment_events',
    Object.entries(before.state.events),
    Object.entries(after.state.events),
    ['id', 'fingerprint'],
    (k, v) => [k, v],
  );
  sync(
    'private_links',
    Object.entries(before.links),
    Object.entries(after.links),
    ['athlete_id', 'capability'],
    (k, v) => [k, v],
    ['athlete_id'],
    true,
  );
  sync(
    'sessions',
    before.auth.sessions,
    after.auth.sessions,
    ['id', 'user_id', 'org_id', 'expires', 'data'],
    (k, v) => [k, v.userId, v.orgId, v.expires, JSON.stringify(v)],
    ['id'],
    true,
  );
  sync(
    'login_attempts',
    before.auth.attempts,
    after.auth.attempts,
    ['id', 'data'],
    (k, v) => [k, JSON.stringify(v)],
    ['id'],
    true,
  );
  if (statements.length) await tx.batch(statements);
}

export async function transactPilot(client, operation) {
  const tx = await client.transaction('write');
  try {
    await assertPilot(tx);
    const before = await loadPilot(tx);
    const snapshot = structuredClone(before);
    const result = await operation(snapshot);
    await savePilot(tx, before, snapshot);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  } finally {
    tx.close();
  }
}

export function validatePilotUrl(value, { local = false } = {}) {
  if (local && /^file:/.test(value || '')) return value;
  const url = new URL(value);
  if (
    !['libsql:', 'https:'].includes(url.protocol) ||
    !url.hostname.startsWith('rallyfund-tvvc-pilot-') ||
    !url.hostname.endsWith('.turso.io') ||
    url.username ||
    url.password ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search ||
    url.hash
  )
    throw new Error('Use the dedicated Turso database URL.');
  return value;
}

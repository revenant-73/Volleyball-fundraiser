import { hash } from '../domain.js';
import { PILOT_ID, migratePilot, transactPilot } from './store.js';

export async function exportPilot(client) {
  const snapshot = await transactPilot(client, (snapshot) => structuredClone(snapshot));
  // Restore must never resurrect an old authenticated session or lockout.
  snapshot.auth = { sessions: [], attempts: [] };
  return {
    database: PILOT_ID,
    format: 1,
    createdAt: new Date().toISOString(),
    snapshot,
    checksum: hash(JSON.stringify(snapshot)),
  };
}

// Recovery rehearsal targets a fresh database, never the active database.
export async function restorePilotToEmpty(client, backup) {
  if (
    backup.database !== PILOT_ID ||
    backup.format !== 1 ||
    hash(JSON.stringify(backup.snapshot)) !== backup.checksum
  )
    throw new Error('Invalid or damaged pilot backup.');
  const tables = (
    await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
  ).rows;
  if (tables.length) throw new Error('Recovery requires an empty database.');
  await migratePilot(client);
  await transactPilot(client, (snapshot) =>
    Object.assign(snapshot, structuredClone(backup.snapshot), {
      auth: { sessions: [], attempts: [] },
    }),
  );
  const integrity = await client.execute('PRAGMA integrity_check');
  const foreignKeys = await client.execute('PRAGMA foreign_key_check');
  if (integrity.rows[0].integrity_check !== 'ok' || foreignKeys.rows.length)
    throw new Error('Restored database integrity check failed.');
  const restored = await exportPilot(client);
  if (restored.checksum !== backup.checksum)
    throw new Error('Restored backup differs from the source.');
  return { integrity: 'ok', checksum: restored.checksum };
}

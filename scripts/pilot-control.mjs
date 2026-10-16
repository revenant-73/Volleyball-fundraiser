import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@libsql/client/web';
import { migratePilot, transactPilot, validatePilotUrl } from '../server/pilot/store.js';
import { addAdmin, replacePassword, normalizeEmail } from '../server/pilot/admin.js';
import { exportPilot, restorePilotToEmpty } from '../server/pilot/backup.js';
import { token } from '../server/domain.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.local', 'pilot');
mkdirSync(local, { recursive: true });
const command = process.argv[2];
const url = validatePilotUrl(process.env.RALLYFUND_TURSO_DATABASE_URL);
if (!process.env.RALLYFUND_TURSO_AUTH_TOKEN)
  throw new Error('Configure the pilot token in .env.pilot.');
const client = createClient({ url, authToken: process.env.RALLYFUND_TURSO_AUTH_TOKEN });
try {
  if (command === 'init') {
    await migratePilot(client);
    console.log('TVVC pilot schema initialized. Review database untouched.');
  } else if (command === 'bootstrap' || command === 'recover-owner') {
    const email = normalizeEmail(process.env.RALLYFUND_OWNER_EMAIL);
    const password = token();
    const credentials = path.join(local, `${command}-${Date.now()}.json`);
    // Save before commit so a lost terminal/response cannot lose the password.
    writeFileSync(
      credentials,
      JSON.stringify(
        { email, password, database: 'rallyfund-tvvc-pilot', status: 'Verify sign-in before use' },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
    await transactPilot(client, (snapshot) => {
      const actor = { orgId: 'tvvc', role: 'owner', userId: `operator:${command}` };
      if (command === 'bootstrap') {
        if (snapshot.state.users.length)
          throw new Error('Bootstrap refuses to replace existing administrators.');
        addAdmin(snapshot.state, actor, { email, password, role: 'owner' });
      } else {
        const user = snapshot.state.users.find(
          (u) => u.email === email && u.orgId === 'tvvc' && u.role === 'owner',
        );
        if (!user) throw new Error('The named TVVC organization owner was not found.');
        const sessions = new Map(snapshot.auth.sessions);
        replacePassword(snapshot.state, sessions, actor, user, password);
        user.active = true;
        snapshot.auth.sessions = [...sessions];
      }
    });
    console.log(`Owner credentials saved privately: ${credentials}`);
  } else if (command === 'status') {
    await transactPilot(client, ({ state }) =>
      console.log(
        JSON.stringify({
          organizations: state.organizations.map((o) => o.id),
          administrators: state.users.length,
          campaigns: state.campaigns.length,
          paymentsEnabled: false,
          emailEnabled: false,
        }),
      ),
    );
  } else if (command === 'backup') {
    const file = path.join(local, `backup-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(await exportPilot(client)), { flag: 'wx', mode: 0o600 });
    console.log(`Private backup saved: ${file}`);
  } else if (command === 'verify-recovery') {
    const file = path.resolve(process.argv[3] || '');
    if (!file.startsWith(local + path.sep)) throw new Error('Choose a backup inside .local/pilot.');
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    const { createClient: localClient } = await import('@libsql/client');
    const target = path.join(local, `restore-rehearsal-${Date.now()}.db`);
    const restored = localClient({ url: `file:${target}` });
    try {
      console.log(JSON.stringify(await restorePilotToEmpty(restored, backup)));
    } finally {
      restored.close();
    }
    console.log(`Recovery verified in a separate local database: ${target}`);
  } else
    throw new Error('Choose init, bootstrap, recover-owner, status, backup or verify-recovery.');
} catch (error) {
  // Never print a remote client error (it can include SQL/private values).
  console.error('Pilot operation failed.', { name: error.name });
  process.exitCode = 1;
} finally {
  client.close();
}

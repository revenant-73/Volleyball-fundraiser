import { createServer } from 'node:http';
import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPilotHandler } from './handler.js';
import { migratePilot, transactPilot } from './store.js';
import { addAdmin } from './admin.js';
import { storageCipher } from './encryption.js';
import { mediaService } from './media.js';
import { cloudBackupService } from './cloud-backup.js';
import { fileObjectStore } from './object-store.js';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = path.resolve(root, process.env.PILOT_TEST_DIR || '.local-pilot');
if (!directory.startsWith(root) || directory === root.slice(0, -1))
  throw new Error('Pilot files must stay inside RallyFund.');
mkdirSync(directory, { recursive: true });
const client = createClient({ url: `file:${path.join(directory, 'pilot.db')}` });
await migratePilot(client);
if (process.env.PILOT_E2E === '1') {
  await transactPilot(client, (snapshot) => {
    if (!snapshot.state.users.length)
      addAdmin(
        snapshot.state,
        { orgId: 'tvvc', role: 'owner', userId: 'test-bootstrap' },
        { email: 'owner@example.test', password: 'fictional-owner-password', role: 'owner' },
      );
  });
}
const port = Number(process.env.PROTOTYPE_API_PORT || 3102);
const webPort = Number(process.env.PROTOTYPE_WEB_PORT || 5175);
const keyFile = path.join(directory, 'storage-key.txt');
if (!existsSync(keyFile))
  writeFileSync(keyFile, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 });
const cipher = storageCipher(readFileSync(keyFile, 'utf8'));
const mediaStore = fileObjectStore(path.join(directory, 'private-media'));
const backupStore = fileObjectStore(path.join(directory, 'encrypted-backups'));
const handler = createPilotHandler({
  client,
  services: {
    media: mediaService({ store: mediaStore, cipher }),
    backups: cloudBackupService({ backupStore, mediaStore, cipher }),
  },
  origins: [`http://127.0.0.1:${port}`, `http://127.0.0.1:${webPort}`],
});
createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const response = await handler(
      new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
      }),
      { ip: req.socket.remoteAddress },
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end('Pilot request failed.');
  }
}).listen(port, '127.0.0.1', () =>
  console.log(`TVVC pilot preparation API: http://127.0.0.1:${port}. Payments and email disabled.`),
);

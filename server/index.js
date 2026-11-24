import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import path from 'node:path';
import { createStripeSandboxClient } from './stripe-client.js';
import { createStripeSandboxSeed, STRIPE_SANDBOX } from './stripe-sandbox.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const sandbox = process.env.RALLYFUND_MODE === STRIPE_SANDBOX;
const directory = path.resolve(
  root,
  sandbox ? '.local/stripe-invite-rehearsal' : process.env.PROTOTYPE_DATA_DIR || '.local',
);
if (!directory.startsWith(root))
  throw new Error('Prototype data must remain inside the project folder.');
const port = Number(process.env.PROTOTYPE_API_PORT || 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid local API port.');
const stripeSandbox = sandbox
  ? createStripeSandboxClient({
      key: process.env.RALLYFUND_STRIPE_TEST_KEY,
      webhookSecret: process.env.RALLYFUND_STRIPE_WEBHOOK_SECRET,
      origin: `http://127.0.0.1:${process.env.PROTOTYPE_WEB_PORT || 5173}`,
    })
  : null;
const { app } = createApp({
  directory,
  stripeSandbox,
  seed: sandbox ? createStripeSandboxSeed() : null,
});
app.listen(port, '127.0.0.1', () =>
  console.log(
    `Rally Fund: http://127.0.0.1:${port} — ${sandbox ? 'Stripe sandbox' : 'local simulation'}.`,
  ),
);

import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.resolve(root, process.env.PROTOTYPE_DATA_DIR || '.local');
if (!directory.startsWith(root))
  throw new Error('Prototype data must remain inside the project folder.');
const port = Number(process.env.PROTOTYPE_API_PORT || 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid local API port.');
const { app } = createApp({ directory });
app.listen(port, '127.0.0.1', () =>
  console.log(
    `Rally Fund prototype: http://127.0.0.1:${port} — local simulation only. No live payment or email adapters.`,
  ),
);

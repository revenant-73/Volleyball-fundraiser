import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { validatePilotUrl } from '../server/pilot/store.js';

const siteId = '042b91a6-50e0-4f18-9d67-0ca7f789cfa9';
const expectedOrigin = 'https://rallyfund-tvvc-pilot.netlify.app';
const cli =
  process.env.NETLIFY_CLI_ENTRY ||
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'netlify-cli', 'bin', 'run.js');
const run = (args) =>
  execFileSync(process.execPath, [cli, ...args], { stdio: 'pipe', encoding: 'utf8' });
try {
  const site = JSON.parse(run(['api', 'getSite', '--data', JSON.stringify({ siteId })]));
  if (site.id !== siteId || site.name !== 'rallyfund-tvvc-pilot')
    throw new Error('Pilot site mismatch');
  const url = validatePilotUrl(process.env.RALLYFUND_TURSO_DATABASE_URL);
  const token = process.env.RALLYFUND_TURSO_AUTH_TOKEN;
  if (!token) throw new Error('Missing pilot token');
  for (const [key, value] of Object.entries({
    RALLYFUND_MODE: 'pilot',
    RALLYFUND_PILOT_ORIGIN: expectedOrigin,
    RALLYFUND_TURSO_DATABASE_URL: url,
    RALLYFUND_TURSO_AUTH_TOKEN: token,
  })) {
    run([
      'env:set',
      key,
      value,
      '--site',
      siteId,
      '--scope',
      'functions',
      '--context',
      'production',
      '--secret',
      '--force',
    ]);
  }
  console.log('Pilot-only function configuration saved. Review site link and settings unchanged.');
} catch (error) {
  console.error('Pilot host configuration failed.', { name: error.name });
  process.exitCode = 1;
}

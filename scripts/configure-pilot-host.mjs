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
let step = 'verify site';
try {
  const site = JSON.parse(run(['api', 'getSite', '--data', JSON.stringify({ siteId })]));
  if (site.id !== siteId || site.name !== 'rallyfund-tvvc-pilot')
    throw new Error('Pilot site mismatch');
  const existingVariables = JSON.parse(
    run(['api', 'getEnvVars', '--data', JSON.stringify({ accountId: site.account_slug, siteId })]),
  );
  const url = validatePilotUrl(process.env.RALLYFUND_TURSO_DATABASE_URL);
  const token = process.env.RALLYFUND_TURSO_AUTH_TOKEN;
  if (!token) throw new Error('Missing pilot token');
  for (const [key, value] of Object.entries({
    RALLYFUND_MODE: 'pilot',
    RALLYFUND_PILOT_ORIGIN: expectedOrigin,
    RALLYFUND_TURSO_DATABASE_URL: url,
    RALLYFUND_TURSO_AUTH_TOKEN: token,
    ...(process.env.RALLYFUND_STORAGE_KEY
      ? { RALLYFUND_STORAGE_KEY: process.env.RALLYFUND_STORAGE_KEY }
      : {}),
  })) {
    step = `configure ${key}`;
    const existing = existingVariables.find((entry) => entry.key === key);
    if (existing && (existing.scopes.length !== 1 || existing.scopes[0] !== 'functions'))
      throw new Error('Pilot variable scope mismatch');
    run([
      'env:set',
      key,
      value,
      '--site',
      siteId,
      ...(!existing ? ['--scope', 'functions'] : []),
      '--context',
      'production',
      '--secret',
      '--force',
    ]);
  }
  console.log('Pilot-only function configuration saved. Review site link and settings unchanged.');
} catch (error) {
  console.error('Pilot host configuration failed.', {
    name: error.name,
    step,
    status: error.status,
  });
  process.exitCode = 1;
}

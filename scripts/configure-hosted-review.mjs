import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteId = '42fb7ae9-52b6-4b50-92de-a9306d4e2353';
const location = path.join(root, '.local', 'hosted-review-credentials.json');
mkdirSync(path.dirname(location), { recursive: true });
const credentials = existsSync(location)
  ? JSON.parse(readFileSync(location, 'utf8'))
  : {
      siteId,
      emails: ['coach@tvvc.example', 'coach@century.example'],
      password: randomBytes(32).toString('base64url'),
    };
if (credentials.siteId !== siteId || credentials.password.length < 24)
  throw new Error(
    'Review credentials do not match this project. Refusing to change site settings.',
  );
writeFileSync(location, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
const cli =
  process.env.NETLIFY_CLI_ENTRY ||
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'netlify-cli', 'bin', 'run.js');
if (!existsSync(cli))
  throw new Error('Install Netlify CLI or set NETLIFY_CLI_ENTRY to its bin/run.js file.');
try {
  // Structured arguments keep credentials out of shell expansion and output.
  execFileSync(
    process.execPath,
    [
      cli,
      'env:set',
      'PROTOTYPE_REVIEW_PASSWORD',
      credentials.password,
      '--site',
      siteId,
      '--scope',
      'functions',
      '--context',
      'production',
      'deploy-preview',
      'branch-deploy',
      '--secret',
      '--force',
    ],
    { cwd: root, stdio: 'pipe' },
  );
  console.log(
    'Hosted review password configured. Private credentials saved in .local/hosted-review-credentials.json.',
  );
} catch (error) {
  const diagnostic = String(error.stderr || error.stdout || error.message).replaceAll(
    credentials.password,
    '[redacted]',
  );
  console.error(diagnostic);
  process.exitCode = 1;
}

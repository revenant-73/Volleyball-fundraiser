import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Netlify runs Linux. When deploying from Windows, include Sharp's Linux
// optional packages alongside (not instead of) the local Windows packages.
if (process.platform === 'win32') {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this helper with npm run prepare:pilot-runtime.');
  const sharp = JSON.parse(readFileSync('node_modules/sharp/package.json', 'utf8'));
  const directory = path.resolve('.local/pilot/native-build');
  mkdirSync(directory, { recursive: true });
  for (const name of ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64']) {
    const version = sharp.optionalDependencies[name];
    const packed = JSON.parse(
      execFileSync(
        process.execPath,
        [npmCli, 'pack', `${name}@${version}`, '--pack-destination', directory, '--json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    );
    const destination = path.resolve('node_modules', name);
    mkdirSync(destination, { recursive: true });
    execFileSync(
      'tar',
      ['-xzf', path.join(directory, packed[0].filename), '-C', destination, '--strip-components=1'],
      { stdio: 'pipe' },
    );
  }
  console.log('Pilot Linux image runtime prepared. Local Windows packages preserved.');
} else console.log('Native image runtime follows this platform’s normal npm installation.');

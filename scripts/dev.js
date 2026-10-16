import { spawn } from 'node:child_process';
const processes = [
  spawn(
    process.execPath,
    [
      '--watch',
      process.env.RALLYFUND_MODE === 'pilot' ? 'server/pilot/local.js' : 'server/index.js',
    ],
    { stdio: 'inherit' },
  ),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
for (const child of processes)
  child.on('exit', () => {
    for (const p of processes) p.kill();
  });
process.on('SIGINT', () => {
  for (const p of processes) p.kill();
});

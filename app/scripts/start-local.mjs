import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { stopChildTree } from './process-tree.mjs';
await access('dist/server/wrangler.json').catch(() => {
  throw new Error('먼저 npm run build를 실행해 주세요.');
});
const children = [
  spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--config',
      'dist/server/wrangler.json',
      '--ip',
      '127.0.0.1',
      '--port',
      '3001',
      '--local',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: 'false',
        WRANGLER_WRITE_LOGS: 'false',
      },
    },
  ),
  spawn(process.execPath, ['server/index.mjs'], {
    stdio: 'inherit',
    env: { ...process.env, SERVE_FRONTEND: '1' },
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopChildTree(child);
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code) => stop(code || 0));
}

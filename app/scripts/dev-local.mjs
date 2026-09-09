import { spawn } from 'node:child_process';
import { stopChildTree } from './process-tree.mjs';
const children = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' }),
  spawn(
    process.execPath,
    ['node_modules/vinext/dist/cli.js', 'dev', '--host', '127.0.0.1'],
    { stdio: 'inherit' },
  ),
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

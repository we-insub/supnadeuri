import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { stopChildTree } from './process-tree.mjs';

// Never test against an already-running personal instance or load its session.
for (const port of [3000, 3001]) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
const directory = await mkdtemp(join(tmpdir(), 'supnadeuri-smoke-'));
const child = spawn(process.execPath, ['scripts/start-local.mjs'], {
  env: {
    ...process.env,
    FORESTTRIP_SESSION_FILE: join(directory, 'missing-session.json'),
    WRANGLER_SEND_METRICS: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
let spawnError;
child.on('error', (error) => { spawnError = error; });
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => { output = (output + chunk).slice(-12000); });
}
const request = (path, options = {}) => fetch(`http://127.0.0.1:3000${path}`, {
  ...options,
  signal: AbortSignal.timeout(5000),
});
try {
  const deadline = Date.now() + 90000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error('Local server exited early');
    try {
      const page = await request('/');
      if (page.ok && (await page.text()).includes('빈방 찾기')) {
        ready = true;
        break;
      }
    } catch { /* Renderer may still be starting. */ }
    await delay(500);
  }
  assert.ok(ready, 'Rendered search page must become available');
  const health = await request('/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).session_configured, false);
  const blocked = await request('/api/health', {
    headers: { origin: 'https://example.com' },
  });
  assert.equal(blocked.status, 403);
  const invalid = await request('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(invalid.status, 400);
  console.log('PASS: production page, health, missing authentication, origin guard, input validation');
  console.log('No personal credentials or Foresttrip requests were used.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  stopChildTree(child);
  await rmdir(directory);
}

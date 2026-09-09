import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeSession,
  decodeSession,
  assertSessionPermissions,
  dpapiCommand,
} from '../session-storage.mjs';
import { windowsStopCommand } from '../../scripts/process-tree.mjs';
const test = (name, run) => {
  void nodeTest(name, run);
};
const session = { cookie: 'test-only-cookie', csrf: 'test-only-csrf' };
// Injected unit-test transform only; production always uses Windows DPAPI.
const crypt = async (bytes) => Buffer.from(bytes).reverse();

test('Windows storage uses a versioned encrypted envelope and restores fields', async () => {
  const stored = await encodeSession(session, { platform: 'win32', crypt });
  assert.equal(stored.protection, 'windows-dpapi-current-user');
  assert.ok(!JSON.stringify(stored).includes(session.cookie));
  assert.deepEqual(
    await decodeSession(stored, { platform: 'win32', crypt }),
    session,
  );
});
test('Windows rejects plaintext, unknown version and malformed encrypted files', async () => {
  for (const stored of [
    session,
    null,
    { version: 2, protection: 'windows-dpapi-current-user', payload: 'YQ==' },
    {
      version: 1,
      protection: 'windows-dpapi-current-user',
      payload: 'not base64',
    },
  ]) {
    await assert.rejects(decodeSession(stored, { platform: 'win32', crypt }));
  }
});
test('DPAPI failure does not fall back to a plaintext credential file', async () => {
  await assert.rejects(
    encodeSession(session, {
      platform: 'win32',
      crypt: async () => {
        throw new Error('test failure');
      },
    }),
  );
});
test('macOS keeps the existing private format and enforces POSIX permissions', async () => {
  assert.deepEqual(
    await encodeSession(session, { platform: 'darwin' }),
    session,
  );
  assert.deepEqual(
    await decodeSession(session, { platform: 'darwin' }),
    session,
  );
  assertSessionPermissions({ mode: 0o600, isFile: () => true }, 'darwin');
  assert.throws(() =>
    assertSessionPermissions({ mode: 0o644, isFile: () => true }, 'darwin'),
  );
  assertSessionPermissions({ mode: 0o666, isFile: () => true }, 'win32');
  await assert.rejects(
    decodeSession(
      { protection: 'windows-dpapi-current-user' },
      { platform: 'darwin' },
    ),
  );
});
test('PowerShell uses fixed CurrentUser operations without secrets in arguments', () => {
  const command = dpapiCommand('Protect');
  const script = Buffer.from(command.args.at(-1), 'base64').toString('utf16le');
  assert.match(script, /DataProtectionScope\]::CurrentUser/);
  assert.match(script, /In.ReadToEnd/);
  assert.ok(!JSON.stringify(command).includes(session.cookie));
  assert.ok(!script.includes('LocalMachine'));
  assert.ok(!command.args.includes('-ExecutionPolicy'));
  assert.throws(() => dpapiCommand('UntrustedOperation'));
});
test('Windows shutdown targets only a validated child PID, never an image name', () => {
  assert.deepEqual(windowsStopCommand(123).args, ['/PID', '123', '/T', '/F']);
  for (const pid of [0, -1, '123 & echo unsafe', NaN])
    assert.throws(() => windowsStopCommand(pid));
});
void nodeTest(
  'actual Windows DPAPI encrypt/decrypt round trip',
  { skip: process.platform !== 'win32' },
  async () => {
    const stored = await encodeSession(session);
    assert.ok(!JSON.stringify(stored).includes(session.cookie));
    assert.deepEqual(await decodeSession(stored), session);
  },
);

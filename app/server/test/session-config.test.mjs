import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionFilePath } from '../session-config.mjs';
const test = (name, run) => {
  void nodeTest(name, run);
};

test('default authentication path remains the existing private local file', () => {
  assert.equal(
    sessionFilePath(''),
    fileURLToPath(new URL('../../../.private/session.json', import.meta.url)),
  );
});
test('backend accepts a mounted absolute secret file outside the app', () => {
  const path = resolve(tmpdir(), 'forest-config-test', 'session.json');
  assert.equal(sessionFilePath(path), path);
});
test('relative authentication paths fail closed', () => {
  assert.throws(() => sessionFilePath('./session.json'), /절대 경로/);
});
test('authentication files cannot be configured under source or public output', () => {
  for (const folder of ['public', 'dist', 'server']) {
    const path = fileURLToPath(
      new URL(`../../${folder}/session.json`, import.meta.url),
    );
    assert.throws(() => sessionFilePath(path), /폴더 밖/);
  }
});

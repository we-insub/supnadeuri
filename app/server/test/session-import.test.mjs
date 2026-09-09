import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  sessionFromHar,
  saveLocalSession,
  MAX_HAR_BYTES,
} from '../session-import.mjs';
import { decodeSession } from '../session-storage.mjs';
const test = (name, run) => {
  void nodeTest(name, run);
};
// Test-only markers, not real credentials or runtime fallback data.
const entry = () => ({
  request: {
    url: 'https://www.foresttrip.go.kr/main.do',
    method: 'GET',
    headers: [{ name: 'Cookie', value: 'test_session=not-a-real-login' }],
  },
  response: {
    status: 200,
    content: { text: '<input name="_csrf" value="not-a-real-token">로그아웃' },
  },
});
const har = (entries = [entry()]) => JSON.stringify({ log: { entries } });
test('single logged main HAR extracts only required local fields', () => {
  const result = sessionFromHar(har());
  assert.deepEqual(Object.keys(result).sort(), [
    'cookie',
    'csrf',
    'imported_at',
  ]);
  assert.equal(result.cookie, 'test_session=not-a-real-login');
});
test('base64 HAR response is supported', () => {
  const e = entry();
  e.response.content.text = Buffer.from(e.response.content.text).toString(
    'base64',
  );
  e.response.content.encoding = 'base64';
  assert.equal(sessionFromHar(har([e])).csrf, 'not-a-real-token');
});
test('malformed or multi-request HAR is rejected without reflecting input', () => {
  assert.throws(
    () => sessionFromHar('PRIVATE_TEST_MARKER'),
    (error) => !error.message.includes('PRIVATE_TEST_MARKER'),
  );
  assert.throws(() => sessionFromHar(har([])), /1건/);
  assert.throws(() => sessionFromHar(har([entry(), entry()])), /1건/);
});
test('only official successful main GET can be imported', () => {
  for (const url of [
    'https://example.com/main.do',
    'http://www.foresttrip.go.kr/main.do',
    'https://www.foresttrip.go.kr/com/login.do',
  ]) {
    const e = entry();
    e.request.url = url;
    assert.throws(() => sessionFromHar(har([e])));
  }
  const post = entry();
  post.request.method = 'POST';
  assert.throws(() => sessionFromHar(har([post])));
  const failed = entry();
  failed.response.status = 401;
  assert.throws(() => sessionFromHar(har([failed])));
});
test('anonymous, missing/duplicate cookie and header injection are rejected', () => {
  const anon = entry();
  anon.response.content.text = '<input name="_csrf" value="test">로그인';
  assert.throws(() => sessionFromHar(har([anon])));
  for (const headers of [
    [],
    [{ name: 'Cookie', value: 'bad\r\nInjected: value' }],
    [...entry().request.headers, ...entry().request.headers],
  ]) {
    const e = entry();
    e.request.headers = headers;
    assert.throws(() => sessionFromHar(har([e])));
  }
});
test('oversized HAR is rejected before JSON parsing', () => {
  assert.throws(() => sessionFromHar('x'.repeat(MAX_HAR_BYTES + 1)), /8MB/);
});
test('local session save is private and atomic with no retained raw capture', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'forest-session-test-'));
  const directory = join(temporary, '.private');
  try {
    const first = sessionFromHar(har());
    await saveLocalSession(first, directory);
    if (process.platform !== 'win32') {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal(
        (await stat(join(directory, 'session.json'))).mode & 0o777,
        0o600,
      );
    }
    const second = { ...first, csrf: 'replacement-test-token' };
    await saveLocalSession(second, directory);
    assert.deepEqual(
      await decodeSession(
        JSON.parse(await readFile(join(directory, 'session.json'), 'utf8')),
      ),
      second,
    );
    assert.deepEqual(await readdir(directory), ['session.json']);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

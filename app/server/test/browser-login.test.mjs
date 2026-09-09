import nodeTest from 'node:test';
const test = (name, run) => {
  void nodeTest(name, run);
};
import assert from 'node:assert/strict';
import { BrowserLogin, sessionFromBrowser } from '../browser-login.mjs';
import { SourceError } from '../errors.mjs';

const sample = () => ({
  url: 'https://www.foresttrip.go.kr/main.do',
  status: 200,
  html: '<a href="/com/logout.do">로그아웃</a><input value="test-only-csrf" name="_csrf">',
  cookies: [
    {
      name: 'SESSION',
      value: 'test-only-cookie',
      domain: 'www.foresttrip.go.kr',
      path: '/',
      expires: -1,
    },
  ],
});
test('own official browser snapshot extracts scoped cookies and CSRF, independent of attribute order', () => {
  const data = sample();
  data.cookies.push({
    ...data.cookies[0],
    domain: 'accounts.example.com',
    value: 'private-other-site',
  });
  const session = sessionFromBrowser(data);
  assert.equal(session.cookie, 'SESSION=test-only-cookie');
  assert.equal(session.csrf, 'test-only-csrf');
});
test('login rejects logged-out, foreign, failed, blocked, expired and malformed snapshots', () => {
  const bad = [
    { url: 'https://www.foresttrip.go.kr.evil.test/main.do' },
    { status: 403 },
    { html: '<a>로그인</a><input name="_csrf" value="test">' },
    { html: sample().html + '개발자 도구가 감지' },
    { cookies: [{ ...sample().cookies[0], value: 'unsafe\r\nvalue' }] },
    { cookies: [{ ...sample().cookies[0], value: 'unsafe;cookie' }] },
    { cookies: [{ ...sample().cookies[0], expires: 1 }] },
    { cookies: [{ ...sample().cookies[0], path: '/other' }] },
    { cookies: [{ ...sample().cookies[0], path: '/rep/o' }] },
    { cookies: [{ ...sample().cookies[0], name: 'bad name' }] },
    { cookies: [] },
  ];
  for (const patch of bad)
    assert.throws(() => sessionFromBrowser({ ...sample(), ...patch }));
});
test('local login mutations require exact Origin and unpredictable per-process token', () => {
  const login = new BrowserLogin();
  const headers = {
    host: '127.0.0.1:3000',
    origin: 'http://127.0.0.1:3000',
    'x-local-login-token': login.token,
  };
  assert.doesNotThrow(() => login.authorize(headers));
  for (const patch of [
    { origin: undefined },
    { origin: 'https://evil.test' },
    { host: 'localhost:3000' },
    { 'x-local-login-token': '' },
    { 'x-local-login-token': '가'.repeat(64) },
    { 'x-local-login-token': new BrowserLogin().token },
  ])
    assert.throws(() => login.authorize({ ...headers, ...patch }), {
      code: 'LOGIN_FORBIDDEN',
    });
});
function fixture(extra = {}) {
  const calls = { launched: 0, saved: 0, invalidated: 0, closed: 0 };
  let closed = false;
  const adapter = {
    read: async () => sample(),
    focus: async () => {},
    closed: () => closed,
    close: async () => {
      closed = true;
      calls.closed++;
    },
  };
  const login = new BrowserLogin({
    launch: async () => {
      calls.launched++;
      closed = false;
      return adapter;
    },
    save: async (session) => {
      assert.equal(session.csrf, 'test-only-csrf');
      calls.saved++;
    },
    onSaved: async () => {
      calls.invalidated++;
    },
    ...extra,
  });
  return { login, calls, adapter };
}
test('failed protected storage never invalidates the old session or leaks errors', async () => {
  const { login, calls } = fixture({ save: async () => { throw new Error('secret-storage-error'); } });
  await login.action('start');
  await assert.rejects(login.action('finish'), { code: 'LOGIN_FAILED' });
  assert.equal(calls.invalidated, 0);
  await login.close();
});
test('start is idempotent; explicit finish saves once, invalidates caches and closes only login browser', async () => {
  const { login, calls } = fixture();
  await login.action('start');
  await login.action('start');
  assert.equal(login.active, true);
  assert.equal(calls.saved, 0);
  await login.action('finish');
  assert.deepEqual(calls, { launched: 1, saved: 1, invalidated: 1, closed: 1 });
  assert.equal(login.active, false);
});
test('cancel and expired login window do not overwrite a previous session', async () => {
  const { login, calls } = fixture();
  await login.action('start');
  await login.action('cancel');
  await assert.rejects(login.action('finish'), { code: 'LOGIN_WINDOW_CLOSED' });
  assert.equal(calls.saved, 0);
});
test('unfinished login retains the window, blocked login closes it, neither saves', async () => {
  const { login, calls, adapter } = fixture();
  await login.action('start');
  adapter.read = async () => ({ ...sample(), html: '<p>로그인</p>' });
  await assert.rejects(login.action('finish'), { code: 'LOGIN_NOT_FINISHED' });
  assert.equal(login.active, true);
  adapter.read = async () => {
    throw new SourceError('LOGIN_PAGE_BLOCKED', 'blocked');
  };
  await assert.rejects(login.action('finish'), { code: 'LOGIN_PAGE_BLOCKED' });
  assert.equal(login.active, false);
  assert.equal(calls.saved, 0);
});
test('search in progress and configured external session path block session mutation', async () => {
  for (const options of [{ isSearching: () => true }, { disabled: true }]) {
    const { login, calls } = fixture(options);
    await assert.rejects(login.action('start'));
    assert.equal(calls.launched, 0);
  }
});
test('browser failures never return raw cookies, page contents or process arguments', async () => {
  const { login, adapter, calls } = fixture();
  await login.action('start');
  adapter.read = async () => {
    throw new Error('secret-cookie-and-password');
  };
  await assert.rejects(
    login.action('finish'),
    (e) => e.code === 'LOGIN_FAILED' && !e.message.includes('secret'),
  );
  assert.equal(calls.saved, 0);
  await login.close();
});
test('simultaneous launch and finish are rejected instead of racing the session write', async () => {
  let release;
  const { login, adapter } = fixture({
    launch: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = login.action('start');
  await assert.rejects(login.action('finish'), { code: 'LOGIN_BUSY' });
  release(adapter);
  await pending;
  await login.close();
});

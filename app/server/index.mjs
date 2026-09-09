import { createServer, request as proxyRequest } from 'node:http';
import { SearchService } from './search.mjs';
import { health, log, SourceError } from './errors.mjs';
import { BrowserLogin } from './browser-login.mjs';
const service = new SearchService();
const login = new BrowserLogin({
  disabled: Boolean(process.env.FORESTTRIP_SESSION_FILE),
  isSearching: () => service.pending.size > 0,
  onSaved: async () => {
    service.cache.clear();
    service.classes.clear();
    service.upstream.mtime = 0;
    await service.upstream.loadSession();
    health.last_error = null;
    health.last_success_at = null;
    health.last_http_success_at = null;
    log('login_connected');
  },
});
const production = process.env.SERVE_FRONTEND === '1';
const server = createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  };
  // Loopback only, strict Host and Origin: no credentialed cross-site localhost proxy.
  if (
    !/^127\.0\.0\.1:(8788|3000)$/.test(req.headers.host || '') &&
    !/^localhost:(8788|3000)$/.test(req.headers.host || '')
  )
    return send(403, { message: '허용되지 않은 호스트입니다.' });
  if (
    req.headers.origin &&
    ![
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'http://127.0.0.1:8788',
    ].includes(req.headers.origin)
  )
    return send(403, { message: '허용되지 않은 요청 출처입니다.' });
  try {
    if (production && !req.url.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method))
        return send(405, { message: '지원하지 않는 요청입니다.' });
      const upstream = proxyRequest(
        {
          hostname: '127.0.0.1',
          port: 3001,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: '127.0.0.1:3001' },
        },
        (remote) => {
          res.writeHead(remote.statusCode || 502, remote.headers);
          remote.pipe(res);
        },
      );
      upstream.setTimeout(20000, () => upstream.destroy());
      upstream.on('error', () => {
        if (!res.headersSent)
          send(503, {
            message: '검색 화면을 준비 중입니다. 잠시 후 새로고침해 주세요.',
          });
        else res.destroy();
      });
      req.pipe(upstream);
      return;
    }
    if (req.url === '/api/health' && req.method === 'GET') {
      let authenticated = false;
      try {
        await service.upstream.loadSession();
        authenticated = true;
      } catch {}
      return send(200, {
        ...health,
        session_configured: authenticated,
        auth_status: authenticated ? service.upstream.authState : 'missing',
        auth_checked_at: service.upstream.authCheckedAt,
        active_searches: service.pending.size,
      });
    }
    if (req.url === '/api/session/status' && req.method === 'GET')
      return send(200, login.status());
    if (req.url.startsWith('/api/session/') && req.method === 'POST') {
      login.authorize(req.headers);
      if (req.headers['content-type'] !== 'application/json')
        return send(415, { message: '지원하지 않는 요청 형식입니다.' });
      // Actions take no cookies, passwords, URLs, paths or other user payload.
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 32) return send(413, { message: '요청이 너무 큽니다.' });
      }
      await login.action(req.url.slice('/api/session/'.length));
      return send(200, {
        ...login.status(),
        connected: req.url.endsWith('/finish'),
      });
    }
    if (req.url !== '/api/search' || req.method !== 'POST')
      return send(404, { message: '요청한 주소가 없습니다.' });
    if (!req.headers['content-type']?.startsWith('application/json'))
      return send(415, { message: 'JSON 요청만 허용됩니다.' });
    if (login.active)
      return send(409, {
        code: 'LOGIN_IN_PROGRESS',
        message: '먼저 로그인 완료·연결 또는 연결 취소를 눌러 주세요.',
      });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192)
        throw new SourceError(
          'PAYLOAD_TOO_LARGE',
          '검색 조건이 너무 큽니다.',
          413,
        );
    }
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      throw new SourceError(
        'INVALID_JSON',
        '검색 조건을 읽을 수 없습니다.',
        400,
      );
    }
    send(200, await service.search(input));
  } catch (e) {
    log('api_failure', { code: e.code || 'UNEXPECTED' });
    send(e.status || 500, {
      code: e.code || 'UNEXPECTED',
      message:
        e instanceof SourceError ? e.message : '조회 중 오류가 발생했습니다.',
    });
  }
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void login.close().finally(() => server.close(() => process.exit(0)));
  });
server.listen(production ? 3000 : 8788, '127.0.0.1', () =>
  log('server_started', {
    url: production ? 'http://127.0.0.1:3000' : 'http://127.0.0.1:8788',
  }),
);

import { readFile, stat } from 'node:fs/promises';
import { SourceError, log, health } from './errors.mjs';
import { sessionFilePath } from './session-config.mjs';
import { assertSessionPermissions, decodeSession } from './session-storage.mjs';
const BASE = 'https://www.foresttrip.go.kr';
const ALLOWED = new Set([
  '/rep/or/innerFcfsRcrfrDtlDetls.do',
  '/rep/or/sssn/innerFcfsRsrvtPssblGoodsDetls.do',
  '/rep/or/innerFcfsRsrvtPssblGoodsDtl.do',
  '/rep/cm/selectGoodsClsscList.do',
]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class Upstream {
  constructor({
    sessionPath = sessionFilePath(),
    fetchImpl = fetch,
    concurrency = 3,
    interval = 250,
    timeout = 12000,
  } = {}) {
    Object.assign(this, {
      sessionPath,
      fetchImpl,
      concurrency,
      interval,
      timeout,
    });
    this.active = 0;
    this.queue = [];
    this.nextStart = 0;
    this.blockedUntil = 0;
    this.session = null;
    this.mtime = 0;
    this.authState = 'unverified';
    this.authCheckedAt = null;
    this.pauseReason = null;
  }
  async loadSession() {
    try {
      const s = await stat(this.sessionPath);
      assertSessionPermissions(s);
      if (this.mtime !== s.mtimeMs) {
        const parsed = await decodeSession(
          JSON.parse(await readFile(this.sessionPath, 'utf8')),
        );
        if (
          typeof parsed.cookie !== 'string' ||
          !parsed.cookie ||
          typeof parsed.csrf !== 'string' ||
          !parsed.csrf ||
          /[\r\n]/.test(parsed.cookie + parsed.csrf)
        )
          throw new Error('session');
        this.session = parsed;
        this.mtime = s.mtimeMs;
        this.blockedUntil = 0;
        this.pauseReason = null;
        this.authState = 'unverified';
        this.authCheckedAt = null;
      }
      return this.session;
    } catch {
      throw new SourceError(
        'AUTH_REQUIRED',
        '숲나들e 로그인 세션이 필요합니다. 이 컴퓨터에서 본인 인증을 다시 연결해 주세요.',
        503,
      );
    }
  }
  async slot(fn) {
    if (this.active >= this.concurrency)
      await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      const wait = Math.max(0, this.nextStart - Date.now());
      this.nextStart = Math.max(Date.now(), this.nextStart) + this.interval;
      if (wait) await sleep(wait);
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
  async post(path, payload, signal) {
    if (!ALLOWED.has(path)) throw new Error('Endpoint not allowed');
    await this.loadSession();
    return this.slot(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted)
          throw new SourceError(
            'SEARCH_TIMEOUT',
            '전체 조회 제한시간을 초과했습니다.',
          );
        if (
          this.blockedUntil > Date.now() &&
          this.pauseReason === 'AUTH_REQUIRED'
        )
          throw new SourceError(
            'AUTH_REQUIRED',
            '로그인을 다시 연결해 주세요. 새 연결 뒤에도 거절되면 숲나들e 접근 제한을 확인해야 합니다.',
            503,
          );
        if (this.blockedUntil > Date.now())
          throw new SourceError(
            'SOURCE_PAUSED',
            '숲나들e가 요청을 제한하고 있습니다. 잠시 후 다시 조회해 주세요.',
            503,
          );
        const started = Date.now();
        let response;
        try {
          health.requests++;
          response = await this.fetchImpl(BASE + path, {
            method: 'POST',
            redirect: 'manual',
            signal: AbortSignal.any([
              AbortSignal.timeout(this.timeout),
              ...(signal ? [signal] : []),
            ]),
            headers: {
              Cookie: this.session.cookie,
              'X-CSRF-TOKEN': this.session.csrf,
              'Content-Type': 'application/json; charset=UTF-8',
              'X-Ajax-call': 'true',
              Referer: BASE + '/main.do',
            },
            body: JSON.stringify(payload),
          });
          log('http_response', {
            path,
            status: response.status,
            attempt,
            duration_ms: Date.now() - started,
          });
          if ([401, 403].includes(response.status)) {
            this.authState = 'reconnect';
            this.authCheckedAt = new Date().toISOString();
            this.pauseReason = 'AUTH_REQUIRED';
            this.blockedUntil = Date.now() + 60000;
            throw new SourceError(
              'AUTH_REQUIRED',
              '숲나들e 로그인 세션이 만료되었거나 조회가 제한되었습니다. 로컬 세션을 다시 연결해 주세요.',
              503,
            );
          }
          if (response.status === 429) {
            this.pauseReason = 'RATE_LIMITED';
            const header = response.headers.get('retry-after');
            const delay =
              header && /^\d+$/.test(header)
                ? Number(header) * 1000
                : header
                  ? Math.max(0, Date.parse(header) - Date.now())
                  : 30000;
            this.blockedUntil =
              Date.now() +
              Math.max(1000, Number.isFinite(delay) ? delay : 30000);
            throw new SourceError(
              'RATE_LIMITED',
              '숲나들e 요청 제한으로 조회를 잠시 중단했습니다.',
              503,
            );
          }
          if (response.status >= 500) {
            if (attempt === 0) {
              await response.body?.cancel();
              await sleep(600);
              continue;
            }
            throw new SourceError(
              'UPSTREAM_HTTP',
              '숲나들e 서버 응답이 원활하지 않습니다.',
            );
          }
          if (response.status !== 200)
            throw new SourceError(
              'UPSTREAM_HTTP',
              '숲나들e가 정상 조회 응답을 반환하지 않았습니다.',
            );
          const body = await response.text();
          if (body.length > 3000000)
            throw new SourceError(
              'BODY_TOO_LARGE',
              '숲나들e 응답 크기가 예상 범위를 초과했습니다.',
            );
          if (
            /"ErrorCode"\s*:\s*"-5"|로그인하시고 다양한|개발자 도구가 감지/.test(
              body,
            )
          ) {
            this.authState = 'reconnect';
            this.authCheckedAt = new Date().toISOString();
            throw new SourceError(
              'AUTH_REQUIRED',
              '숲나들e 인증 또는 접근 상태를 확인해 주세요.',
              503,
            );
          }
          if (this.authState !== 'reconnect') {
            this.authState = 'verified';
            this.authCheckedAt = new Date().toISOString();
          }
          health.last_http_success_at = new Date().toISOString();
          return body;
        } catch (e) {
          if (e instanceof SourceError) {
            health.last_error = { at: new Date().toISOString(), code: e.code };
            throw e;
          }
          log('http_failure', { path, attempt, code: e.name || 'NETWORK' });
          if (attempt === 0 && !signal?.aborted) {
            await sleep(600);
            continue;
          }
          throw new SourceError(
            'NETWORK_TIMEOUT',
            '숲나들e 응답을 기다리다 연결이 끊어졌습니다.',
          );
        }
      }
    });
  }
}

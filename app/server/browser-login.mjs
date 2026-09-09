import { randomBytes, timingSafeEqual } from 'node:crypto';
import { load } from 'cheerio';
import { SourceError } from './errors.mjs';
import { saveLocalSession } from './session-import.mjs';

const BASE = 'https://www.foresttrip.go.kr';
const MAIN = BASE + '/main.do';
const QUERY = BASE + '/rep/or/innerFcfsRcrfrDtlDetls.do';
const fail = (code, message, status = 409) =>
  new SourceError(code, message, status);

export function sessionFromBrowser({ url, status, html, cookies }) {
  if (
    url !== MAIN ||
    status !== 200 ||
    typeof html !== 'string' ||
    /개발자 도구가 감지|요청하신 페이지를 찾을 수 없|접근이 제한/.test(html)
  )
    throw fail(
      'LOGIN_PAGE_BLOCKED',
      '공식 사이트에서 로그인 화면을 정상적으로 열지 못했습니다. 접근 제한을 해제하거나 우회하지 말고 공식 사이트 상태를 확인해 주세요.',
    );
  const $ = load(html);
  const csrf = $('input[name="_csrf"]').first().val();
  const loggedIn = $('a, button')
    .toArray()
    .some((node) => $(node).text().trim() === '로그아웃');
  // Only cookies applicable to the official read endpoint are requested by the adapter.
  const selected = Array.isArray(cookies)
    ? cookies.filter(
        (c) =>
          [
            'foresttrip.go.kr',
            '.foresttrip.go.kr',
            'www.foresttrip.go.kr',
            '.www.foresttrip.go.kr',
          ].includes(c.domain) &&
          (c.expires === -1 || c.expires > Date.now() / 1000) &&
          typeof c.path === 'string' &&
          (new URL(QUERY).pathname === c.path ||
            new URL(QUERY).pathname.startsWith(
              c.path.endsWith('/') ? c.path : c.path + '/',
            )),
      )
    : [];
  if (
    !loggedIn ||
    typeof csrf !== 'string' ||
    !csrf ||
    csrf.length > 2048 ||
    /[\r\n]/.test(csrf) ||
    !selected.length ||
    selected.some(
      (c) =>
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(c.name) ||
        typeof c.value !== 'string' ||
        Array.from(c.value).some(
          (char) =>
            char.charCodeAt(0) <= 32 ||
            char.charCodeAt(0) === 127 ||
            char === ';',
        ),
    )
  )
    throw fail(
      'LOGIN_NOT_FINISHED',
      '열린 Chrome 창에서 본인 로그인을 마친 뒤 다시 눌러 주세요.',
    );
  const cookie = selected.map((c) => `${c.name}=${c.value}`).join('; ');
  if (cookie.length > 16384)
    throw fail('LOGIN_INVALID', '로그인 정보를 확인하지 못했습니다.');
  return { cookie, csrf, imported_at: new Date().toISOString() };
}

// A dedicated, temporary Chrome instance. Never attach to a daily profile,
// export HAR, record passwords, disable security, or conceal automation.
export async function launchLoginBrowser() {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    chromiumSandbox: true,
    timeout: 30000,
  });
  try {
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const initial = await page.goto(MAIN, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    if (
      !initial?.ok() ||
      new URL(page.url()).pathname === '/com/error.do' ||
      /개발자 도구가 감지|요청하신 페이지를 찾을 수 없|접근이 제한/.test(
        await page.content(),
      )
    )
      throw fail(
        'LOGIN_PAGE_BLOCKED',
        '숲나들e가 이 로그인 창의 접근을 제한했습니다. 이 방식으로 연결할 수 없습니다.',
      );
    return {
      closed: () => !browser.isConnected(),
      focus: () => page.bringToFront(),
      close: () => browser.close(),
      async read() {
        // Inspect the current page before navigation: never try another entry
        // point after the site explicitly blocks this login window.
        if (page.isClosed())
          throw fail(
            'LOGIN_WINDOW_CLOSED',
            '로그인 창이 닫혔습니다. 다시 로그인 창을 열어 주세요.',
          );
        const current = new URL(page.url());
        if (current.origin !== BASE)
          throw fail(
            'LOGIN_NOT_FINISHED',
            '본인 인증을 마치고 숲나들e 화면으로 돌아온 뒤 눌러 주세요.',
          );
        const currentHtml = await page.content();
        if (
          current.pathname === '/com/error.do' ||
          /개발자 도구가 감지|요청하신 페이지를 찾을 수 없|접근이 제한/.test(
            currentHtml,
          )
        )
          throw fail(
            'LOGIN_PAGE_BLOCKED',
            '숲나들e가 이 로그인 창의 접근을 제한했습니다. 이 방식으로 연결할 수 없습니다.',
          );
        const response = await page.goto(MAIN, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        return {
          url: page.url(),
          status: response?.status(),
          html: await page.content(),
          cookies: await context.cookies(QUERY),
        };
      },
    };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

export class BrowserLogin {
  constructor({
    launch = launchLoginBrowser,
    save = saveLocalSession,
    onSaved = async () => {},
    isSearching = () => false,
    disabled = false,
    lifetime = 10 * 60 * 1000,
  } = {}) {
    Object.assign(this, {
      launch,
      save,
      onSaved,
      isSearching,
      disabled,
      lifetime,
    });
    this.token = randomBytes(32).toString('hex');
    this.browser = null;
    this.busy = false;
    this.timer = null;
  }
  get active() {
    return this.busy || (this.browser !== null && !this.browser.closed());
  }
  status() {
    return {
      login_window_open: this.active,
      login_busy: this.busy,
      login_enabled: !this.disabled,
      action_token: this.token,
    };
  }
  authorize(headers) {
    const token = headers['x-local-login-token'];
    if (
      headers.origin !== `http://${headers.host}` ||
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(this.token))
    )
      throw fail(
        'LOGIN_FORBIDDEN',
        '이 컴퓨터의 검색 화면에서 로그인 버튼을 눌러 주세요.',
        403,
      );
  }
  async action(kind) {
    if (this.disabled)
      throw fail(
        'LOGIN_DISABLED',
        '별도 인증 경로 설정을 해제한 뒤 프로그램을 다시 실행해 주세요.',
      );
    if (this.busy || this.isSearching())
      throw fail('LOGIN_BUSY', '진행 중인 작업이 끝난 뒤 다시 눌러 주세요.');
    this.busy = true;
    try {
      if (kind === 'start') {
        if (this.browser && !this.browser.closed()) {
          await this.browser.focus();
          return;
        }
        await this.close();
        this.browser = await this.launch();
        this.timer = setTimeout(() => {
          void this.close();
        }, this.lifetime);
        this.timer.unref?.();
      } else if (kind === 'finish') {
        if (!this.browser || this.browser.closed())
          throw fail('LOGIN_WINDOW_CLOSED', '먼저 로그인 창을 열어 주세요.');
        const session = sessionFromBrowser(await this.browser.read());
        await this.save(session);
        await this.onSaved();
        await this.close();
      } else if (kind === 'cancel') {
        await this.close();
      } else
        throw fail(
          'LOGIN_ACTION_UNKNOWN',
          '지원하지 않는 로그인 요청입니다.',
          404,
        );
    } catch (error) {
      if (error.code === 'LOGIN_PAGE_BLOCKED') await this.close();
      if (error instanceof SourceError) throw error;
      // Browser errors can contain URLs, page snippets and process arguments.
      throw fail(
        'LOGIN_FAILED',
        '로그인 연결을 완료하지 못했습니다. Chrome 설치 여부와 로그인 창을 확인해 주세요. 기존 인증은 연결에 성공할 때만 교체합니다.',
        503,
      );
    } finally {
      this.busy = false;
    }
  }
  async close() {
    clearTimeout(this.timer);
    this.timer = null;
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => {});
  }
}

import {
  mkdir,
  chmod,
  lstat,
  writeFile,
  rename,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { encodeSession } from './session-storage.mjs';
export const MAX_HAR_BYTES = 8 * 1024 * 1024;

export function sessionFromHar(text) {
  if (Buffer.byteLength(text) > MAX_HAR_BYTES)
    throw new Error(
      '인증 파일은 8MB 이하의 메인 요청 1건만 사용할 수 있습니다.',
    );
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('올바른 HAR 파일이 아닙니다.');
  }
  const entries = data?.log?.entries;
  if (!Array.isArray(entries) || entries.length !== 1)
    throw new Error(
      '다른 요청을 포함하지 않은 로그인 메인 요청 1건의 HAR가 필요합니다.',
    );
  const entry = entries[0];
  let url;
  try {
    url = new URL(entry?.request?.url);
  } catch {
    throw new Error('숲나들e 메인 요청을 확인할 수 없습니다.');
  }
  if (
    url.origin !== 'https://www.foresttrip.go.kr' ||
    url.pathname !== '/main.do' ||
    entry.request.method !== 'GET' ||
    entry.response?.status !== 200
  )
    throw new Error('로그인된 숲나들e /main.do GET 요청(200)이 필요합니다.');
  const headers = entry.request.headers;
  const cookies = Array.isArray(headers)
    ? headers.filter(
        (h) => typeof h?.name === 'string' && h.name.toLowerCase() === 'cookie',
      )
    : [];
  const cookie = cookies.length === 1 ? cookies[0].value : null;
  const content = entry.response.content;
  if (
    typeof content?.text !== 'string' ||
    (content.encoding && content.encoding !== 'base64')
  )
    throw new Error('메인 화면 응답이 포함된 HAR가 필요합니다.');
  const source =
    content.encoding === 'base64'
      ? Buffer.from(content.text, 'base64').toString('utf8')
      : content.text;
  const csrf = source.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/)?.[1];
  if (
    typeof cookie !== 'string' ||
    !cookie ||
    cookie.length > 16384 ||
    /[\r\n]/.test(cookie) ||
    !csrf ||
    csrf.length > 2048 ||
    /[\r\n]/.test(csrf) ||
    !source.includes('로그아웃')
  )
    throw new Error(
      '로그인된 메인 요청의 쿠키/CSRF를 찾지 못했습니다. 새로 로그인한 본인 파일을 확인해 주세요.',
    );
  return { cookie, csrf, imported_at: new Date().toISOString() };
}

export async function saveLocalSession(
  session,
  directory = fileURLToPath(new URL('../../.private/', import.meta.url)),
) {
  const stored = await encodeSession(session);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error('인증 폴더는 심볼릭 링크가 아닌 전용 폴더여야 합니다.');
  if (process.platform !== 'win32') await chmod(directory, 0o700);
  const temporary = join(directory, `.session-${randomUUID()}.tmp`);
  const target = join(directory, 'session.json');
  try {
    await writeFile(temporary, JSON.stringify(stored), {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

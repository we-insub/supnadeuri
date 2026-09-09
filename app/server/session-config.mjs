import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('../', import.meta.url));

// Only the backend reads this setting. The environment carries a file path,
// never the cookie itself; the actual credential stays outside the app tree.
export function sessionFilePath(
  configured = process.env.FORESTTRIP_SESSION_FILE,
) {
  if (!configured)
    return fileURLToPath(
      new URL('../../.private/session.json', import.meta.url),
    );
  if (!isAbsolute(configured))
    throw new Error(
      'FORESTTRIP_SESSION_FILE은 인증 파일의 절대 경로여야 합니다.',
    );
  const target = resolve(configured);
  const within = relative(appRoot, target);
  if (!within || (!within.startsWith('..' + sep) && !isAbsolute(within))) {
    throw new Error(
      '인증 파일은 app 소스·공개 파일 폴더 밖에 보관해야 합니다.',
    );
  }
  return target;
}

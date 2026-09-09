import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import {
  MAX_HAR_BYTES,
  sessionFromHar,
  saveLocalSession,
} from '../server/session-import.mjs';

try {
  let path = process.argv[2];
  if (path === '--interactive') {
    console.log(
      '실행 중인 숲 빈방 창을 먼저 종료해 주세요. 본인 HAR를 연결하면 이 컴퓨터의 기존 인증이 교체됩니다.',
    );
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      path = (
        await prompt.question(
          '본인 HAR 파일의 전체 경로를 붙여 넣으세요 (취소: 빈 Enter): ',
        )
      ).trim();
      if (
        (path.startsWith('"') && path.endsWith('"')) ||
        (path.startsWith("'") && path.endsWith("'"))
      )
        path = path.slice(1, -1);
    } finally {
      prompt.close();
    }
    if (!path) {
      console.log('인증 연결을 취소했습니다.');
      process.exit(0);
    }
  }
  if (!path)
    throw new Error('본인이 저장한 숲나들e HAR 파일 경로가 필요합니다.');
  if (process.env.FORESTTRIP_SESSION_FILE)
    throw new Error(
      '별도 인증 경로 설정을 해제한 뒤 로컬 인증을 연결해 주세요.',
    );
  const info = await stat(path).catch(() => {
    throw new Error('선택한 파일을 읽을 수 없습니다. 경로를 확인해 주세요.');
  });
  if (!info.isFile() || info.size > MAX_HAR_BYTES)
    throw new Error('8MB 이하의 HAR 파일을 선택해 주세요.');
  const text = await readFile(path, 'utf8').catch(() => {
    throw new Error('선택한 파일을 읽을 수 없습니다.');
  });
  const session = sessionFromHar(text);
  await saveLocalSession(session).catch(() => {
    throw new Error(
      '로컬 인증을 저장하지 못했습니다. 프로젝트 폴더 쓰기 권한을 확인해 주세요.',
    );
  });
  console.log(
    '이 컴퓨터의 인증 연결 완료. 운영체제에 맞는 숲빈방 실행 파일을 다시 실행해 주세요. 인증 값은 출력하거나 업로드하지 않았습니다.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

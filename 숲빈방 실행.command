#!/bin/zsh
cd -- "${0:A:h}/app" || exit 1
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  print 'Node.js 22.13 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요.'
  read -r '?Enter를 누르면 닫습니다.'
  exit 1
fi
node scripts/check-runtime.mjs || {
  print 'Node.js 22.13 이상으로 업데이트해 주세요.'
  read -r '?Enter를 누르면 닫습니다.'
  exit 1
}
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
# Rebuild so downloaded source updates are reflected in the local page.
npm run build || exit 1
if [[ ! -f ../.private/session.json ]]; then
  print '첫 사용입니다. 검색 화면의 본인 인증 연결 안내를 확인해 주세요.'
fi
print '숲 빈방: http://127.0.0.1:3000'
print '이 창을 닫으면 로컬 서비스가 종료됩니다.'
npm start

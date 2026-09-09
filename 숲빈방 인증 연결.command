#!/bin/zsh
cd -- "${0:A:h}/app" || exit 1
if ! command -v node >/dev/null; then
  print 'Node.js 22.13 이상을 먼저 설치해 주세요: https://nodejs.org'
  read -r '?Enter를 누르면 닫습니다.'
  exit 1
fi
node scripts/check-runtime.mjs || {
  read -r '?Enter를 누르면 닫습니다.'
  exit 1
}
print '먼저 실행 중인 숲 빈방 터미널 창을 닫아 주세요.'
print '본인 계정으로 로그인한 숲나들e 메인 요청 1건의 HAR만 사용합니다.'
print '이 컴퓨터의 기존 인증 파일이 본인의 새 파일로 교체됩니다. 외부로 전송하지 않습니다.'
read -r 'session_input?HAR 파일을 이 창에 끌어다 놓고 Enter를 누르세요 (취소: 빈 Enter): '
[[ -z "$session_input" ]] && exit 0
# Tokenize Finder drag-and-drop quoting, including a trailing space, without eval.
typeset -a session_paths
session_paths=(${(z)session_input})
if (( ${#session_paths} != 1 )); then
  print 'HAR 파일 한 개만 끌어다 놓아 주세요.'
  read -r '?Enter를 누르면 닫습니다.'
  exit 1
fi
session_input=${(Q)session_paths[1]}
node scripts/import-session.mjs "$session_input"
session_result=$?
read -r '?Enter를 누르면 닫습니다.'
exit "$session_result"

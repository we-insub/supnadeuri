const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    'Node.js 22.13 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 실행 창을 다시 열어 주세요.',
  );
  process.exitCode = 1;
}

import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

const protection = 'windows-dpapi-current-user';

// No credential enters command arguments or environment variables. Only a
// fixed script is encoded; data travels over private stdin/stdout pipes.
export function dpapiCommand(operation) {
  if (!['Protect', 'Unprotect'].includes(operation))
    throw new Error('Invalid DPAPI operation');
  const script = `$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[System.Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result)); } catch { exit 1 }`;
  return {
    file: win32.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
  };
}

export async function windowsProtect(bytes, operation) {
  const command = dpapiCommand(operation);
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const chunks = [];
    let length = 0;
    const fail = () =>
      reject(
        new Error(
          'Windows 인증 보호 처리에 실패했습니다. 같은 Windows 사용자로 다시 연결해 주세요.',
        ),
      );
    const timer = setTimeout(() => {
      child.kill();
      fail();
    }, 15000);
    child.on('error', () => {
      clearTimeout(timer);
      fail();
    });
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      length += chunk.length;
      if (length > 131072) {
        child.kill();
        clearTimeout(timer);
        fail();
      } else chunks.push(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('ascii').trim();
      if (code !== 0 || !output || !/^[A-Za-z0-9+/]+={0,2}$/.test(output))
        return fail();
      resolve(Buffer.from(output, 'base64'));
    });
    child.stdin.end(bytes.toString('base64'));
  });
}

export async function encodeSession(
  session,
  { platform = process.platform, crypt = windowsProtect } = {},
) {
  if (platform !== 'win32') return session;
  const encrypted = await crypt(
    Buffer.from(JSON.stringify(session), 'utf8'),
    'Protect',
  );
  return { version: 1, protection, payload: encrypted.toString('base64') };
}

export async function decodeSession(
  stored,
  { platform = process.platform, crypt = windowsProtect } = {},
) {
  if (platform !== 'win32') {
    if (stored?.protection)
      throw new Error('다른 운영체제에서 만든 인증은 다시 연결해 주세요.');
    return stored;
  }
  if (
    stored?.version !== 1 ||
    stored.protection !== protection ||
    typeof stored.payload !== 'string' ||
    stored.payload.length > 131072 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(stored.payload)
  )
    throw new Error('Windows 인증 파일을 본인 계정으로 다시 연결해 주세요.');
  const plain = await crypt(Buffer.from(stored.payload, 'base64'), 'Unprotect');
  return JSON.parse(plain.toString('utf8'));
}

export function assertSessionPermissions(info, platform = process.platform) {
  if (!info.isFile()) throw new Error('인증 파일이 아닙니다.');
  // Windows chmod does not implement POSIX owner/group permissions. Windows
  // instead requires the current-user DPAPI envelope during decodeSession.
  if (platform !== 'win32' && (info.mode & 0o077) !== 0)
    throw new Error('permissions');
}

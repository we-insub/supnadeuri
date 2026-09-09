import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

export function windowsStopCommand(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('Invalid child PID');
  return {
    file: win32.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'taskkill.exe',
    ),
    args: ['/PID', String(pid), '/T', '/F'],
  };
}

export function stopChildTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
    return;
  }
  // Restrict tree shutdown to the specific process launched by this program.
  const command = windowsStopCommand(child.pid);
  const stopper = spawn(command.file, command.args, {
    windowsHide: true,
    stdio: 'ignore',
  });
  stopper.on('error', () => child.kill());
}

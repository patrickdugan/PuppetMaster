import { spawn } from 'node:child_process';
import path from 'node:path';

export function startCommand(cmd, cwd) {
  const child = spawn(cmd, { cwd, shell: true, stdio: 'inherit' });
  return child;
}

export function stopCommand(child) {
  if (!child) return;
  child.kill('SIGTERM');
}

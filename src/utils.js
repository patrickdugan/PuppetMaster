import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

export function listInteractiveSelectors() {
  return [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[tabindex]'
  ];
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = String(argv[i] ?? '');
    if (!token.startsWith('--')) continue;

    const eqIdx = token.indexOf('=');
    if (eqIdx > 2) {
      const k = token.slice(2, eqIdx);
      const raw = token.slice(eqIdx + 1);
      if (raw === 'true') args[k] = true;
      else if (raw === 'false') args[k] = false;
      else args[k] = raw;
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || String(next).startsWith('--')) {
      args[key] = true;
      continue;
    }

    if (next === 'true') args[key] = true;
    else if (next === 'false') args[key] = false;
    else args[key] = next;
    i += 1;
  }
  return args;
}

export function normalizePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

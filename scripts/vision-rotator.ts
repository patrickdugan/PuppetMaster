import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';

type KeySpec = {
  name: string;
  path: string;
  limit: number;
};

type UsageState = {
  month: string;
  usage: Record<string, number>;
};

type CropBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type ResultItem = {
  image: string;
  status: 'ok' | 'fail';
  keyName?: string;
  textLength?: number;
  text?: string | null;
  error?: string;
};

function usage(): string {
  return [
    'Usage:',
    'npm run vision:rotator -- --input-dir "<folder>" --key-pool-file "<keys/pool.json>" [options]',
    '',
    'Options:',
    '--output-json <path>     Output report path (default: runs/vision-rotator-<ts>.json)',
    '--usage-file <path>      Usage tracker file (default: runs/vision-usage.json)',
    '--extensions <list>      Comma list, default: .jpg,.jpeg,.png',
    '--crop <l,t,r,b>         Optional crop rectangle in pixels (example: 300,0,900,720)',
    '--include-text           Include full OCR text in report items',
  ].join('\n');
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function monthKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function ensureDirFor(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadUsageState(usageFile: string, keys: KeySpec[]): UsageState {
  const currentMonth = monthKey();
  if (!fs.existsSync(usageFile)) {
    return {
      month: currentMonth,
      usage: Object.fromEntries(keys.map((k) => [k.name, 0])),
    };
  }
  const state = loadJson<UsageState>(usageFile);
  if (state.month !== currentMonth) {
    return {
      month: currentMonth,
      usage: Object.fromEntries(keys.map((k) => [k.name, 0])),
    };
  }
  for (const key of keys) {
    if (typeof state.usage[key.name] !== 'number') state.usage[key.name] = 0;
  }
  return state;
}

function saveUsageState(usageFile: string, state: UsageState) {
  ensureDirFor(usageFile);
  fs.writeFileSync(usageFile, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function pickAvailableKey(keys: KeySpec[], state: UsageState): KeySpec | null {
  for (const key of keys) {
    const used = state.usage[key.name] ?? 0;
    if (used < key.limit) return key;
  }
  return null;
}

function isQuotaExceeded(err: unknown): boolean {
  const text = String(err || '').toLowerCase();
  return text.includes('quota') || text.includes('resource_exhausted') || text.includes('429');
}

function parseCrop(value?: string): CropBox | undefined {
  if (!value) return undefined;
  const parts = value.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((v) => Number.isNaN(v))) {
    throw new Error(`Invalid --crop value: "${value}"`);
  }
  const [left, top, right, bottom] = parts;
  if (left < 0 || top < 0 || right <= left || bottom <= top) {
    throw new Error(`Invalid --crop bounds: "${value}"`);
  }
  return { left, top, right, bottom };
}

async function loadImageContent(imagePath: string, crop?: CropBox): Promise<Buffer> {
  if (!crop) return fs.readFileSync(imagePath);
  const width = crop.right - crop.left;
  const height = crop.bottom - crop.top;
  return sharp(imagePath)
    .extract({ left: crop.left, top: crop.top, width, height })
    .jpeg({ quality: 95 })
    .toBuffer();
}

function listImages(inputDir: string, extensions: string[]): string[] {
  const extSet = new Set(extensions.map((e) => e.toLowerCase().trim()));
  return fs.readdirSync(inputDir)
    .map((f) => path.join(inputDir, f))
    .filter((full) => fs.statSync(full).isFile())
    .filter((full) => extSet.has(path.extname(full).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

async function detectTextWithRotation(
  imageContent: Buffer,
  keys: KeySpec[],
  state: UsageState
): Promise<{ text: string | null; keyName: string }> {
  let lastErr: unknown;
  while (true) {
    const key = pickAvailableKey(keys, state);
    if (!key) {
      const extra = lastErr ? ` Last error: ${String(lastErr)}` : '';
      throw new Error(`All configured key limits are exhausted.${extra}`);
    }

    const client = new ImageAnnotatorClient({ keyFilename: key.path });
    try {
      const [response] = await client.textDetection({ image: { content: imageContent } });
      const text = response.fullTextAnnotation?.text || response.textAnnotations?.[0]?.description || null;
      state.usage[key.name] = (state.usage[key.name] ?? 0) + 1;
      return { text, keyName: key.name };
    } catch (err) {
      lastErr = err;
      if (isQuotaExceeded(err)) {
        state.usage[key.name] = key.limit;
        continue;
      }
      throw err;
    } finally {
      await client.close().catch(() => {});
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  const inputDir = String(args['input-dir'] || '');
  const keyPoolFile = String(args['key-pool-file'] || '');
  if (!inputDir || !keyPoolFile) {
    throw new Error(`Missing required args.\n\n${usage()}`);
  }
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }
  if (!fs.existsSync(keyPoolFile)) {
    throw new Error(`Key pool file not found: ${keyPoolFile}`);
  }

  const outputJson = String(
    args['output-json']
      || path.join('runs', `vision-rotator-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  );
  const usageFile = String(args['usage-file'] || path.join('runs', 'vision-usage.json'));
  const extensions = String(args.extensions || '.jpg,.jpeg,.png').split(',');
  const crop = parseCrop(args.crop ? String(args.crop) : undefined);
  const includeText = Boolean(args['include-text']);

  const keys = loadJson<KeySpec[]>(keyPoolFile);
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('Key pool must be a non-empty JSON array.');
  }
  for (const key of keys) {
    if (!key?.name || !key?.path || typeof key?.limit !== 'number') {
      throw new Error('Each key must have {name, path, limit}.');
    }
    if (!fs.existsSync(key.path)) {
      throw new Error(`Key file does not exist for ${key.name}: ${key.path}`);
    }
  }

  const state = loadUsageState(usageFile, keys);
  const images = listImages(inputDir, extensions);
  const startedAt = new Date().toISOString();
  const results: ResultItem[] = [];
  let failures = 0;

  for (const imagePath of images) {
    try {
      const content = await loadImageContent(imagePath, crop);
      const result = await detectTextWithRotation(content, keys, state);
      results.push({
        image: imagePath,
        status: 'ok',
        keyName: result.keyName,
        textLength: result.text?.length || 0,
        text: includeText ? result.text : undefined,
      });
    } catch (err) {
      failures += 1;
      results.push({
        image: imagePath,
        status: 'fail',
        error: String(err),
      });
    } finally {
      saveUsageState(usageFile, state);
    }
  }

  const endedAt = new Date().toISOString();
  const report = {
    run_id: `vision-rotator-${Date.now()}`,
    mission: 'research',
    target: inputDir,
    started_at: startedAt,
    ended_at: endedAt,
    checks: [
      {
        name: 'key_pool_loaded',
        status: 'pass',
        evidence: [keyPoolFile],
      },
      {
        name: 'images_processed',
        status: failures > 0 ? 'warn' : 'pass',
        evidence: [outputJson],
      },
    ],
    metrics: {
      total_images: images.length,
      ok: results.filter((r) => r.status === 'ok').length,
      fail: failures,
      usage_file: usageFile,
      usage_month: state.month,
    },
    outputs: results,
    next_actions: failures > 0
      ? ['Inspect failed items and key quota state before rerun.']
      : ['Review extracted text and feed downstream checks.'],
  };

  ensureDirFor(outputJson);
  fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  console.log(outputJson);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

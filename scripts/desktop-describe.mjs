import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callVisionJudge, encodeImage } from '../src/openai.js';

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out.set(key, 'true');
      continue;
    }
    out.set(key, next);
    i += 1;
  }
  return out;
}

function readApiKeyFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const direct = raw.trim();
  if (direct.startsWith('sk-')) return direct;
  const match = raw.match(/sk-[A-Za-z0-9_\-]+/);
  return match ? match[0] : '';
}

function resolveApiKey(map) {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const explicit = map.get('api-key-file');
  const home = os.homedir();
  const candidates = [
    explicit,
    path.join(home, 'OneDrive', 'Desktop', 'GPTAPI.txt'),
    path.join(home, 'Desktop', 'GPTAPI.txt'),
    'C:\\Users\\patri\\OneDrive\\Desktop\\GPTAPI.txt',
    'C:\\Users\\patri\\Desktop\\GPTAPI.txt'
  ].filter(Boolean);

  for (const filePath of candidates) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    try {
      const key = readApiKeyFromFile(filePath);
      if (key) return key;
    } catch {
      // ignore candidate and continue
    }
  }
  throw new Error('No API key found. Set OPENAI_API_KEY or provide --api-key-file (Desktop GPTAPI.txt is supported).');
}

function collectImages(inputDir) {
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp']);
  return fs.readdirSync(inputDir)
    .map((name) => path.join(inputDir, name))
    .filter((full) => {
      if (!fs.statSync(full).isFile()) return false;
      return allowed.has(path.extname(full).toLowerCase());
    })
    .sort((a, b) => a.localeCompare(b));
}

async function main() {
  const args = parseArgs(process.argv);
  const inputDir = String(args.get('input-dir') || '').trim();
  if (!inputDir) {
    console.error('Usage: npm run desktop:describe -- --input-dir "<folder>" [--out-dir "<folder>"] [--prompt "<text>"] [--model "gpt-5-mini"] [--api-key-file "<path>"]');
    process.exit(2);
  }

  const outDir = String(args.get('out-dir') || inputDir);
  const prompt = String(
    args.get('prompt')
    || 'Describe this desktop wallet screen for QA automation. Return concise JSON-like bullets for: state, visible_controls, blocking_overlays, next_safe_click.'
  );
  const model = String(args.get('model') || process.env.OPENAI_MODEL || 'gpt-5-mini');
  const images = collectImages(inputDir);

  if (images.length === 0) {
    throw new Error(`No image files found in ${inputDir}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  process.env.OPENAI_API_KEY = resolveApiKey(args);
  process.env.OPENAI_MODEL = model;

  const rows = [];
  for (const imagePath of images) {
    const text = await callVisionJudge({
      prompt,
      images: [encodeImage(imagePath)],
      metadata: {
        mode: 'desktop-describe',
        image: path.basename(imagePath)
      }
    });
    const outPath = path.join(outDir, `${path.basename(imagePath)}.vision.txt`);
    fs.writeFileSync(outPath, text, 'utf-8');
    rows.push({
      image: imagePath,
      vision_file: outPath,
      chars: text.length
    });
    console.log(`described ${path.basename(imagePath)}`);
  }

  const report = {
    created_utc: new Date().toISOString(),
    input_dir: inputDir,
    out_dir: outDir,
    model,
    image_count: images.length,
    files: rows
  };
  const reportPath = path.join(outDir, 'desktop-vision-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(reportPath);
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(1);
});

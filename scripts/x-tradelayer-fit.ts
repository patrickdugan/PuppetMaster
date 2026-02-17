import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

type Mode = 'bio-only' | 'profile';

type CliArgs = {
  handlesFile: string;
  outCsv: string;
  outJson: string;
  headless: boolean;
  mode: Mode;
  gaitMs: number;
  gaitMinMs: number;
  gaitMaxMs: number;
  maxProfiles: number;
  apiKeyFile?: string;
  model: string;
  screenshotDir: string;
};

type InputProfile = {
  handle: string;
  profileUrl: string;
  inputBio: string;
};

type RankedLead = {
  handle: string;
  profile_url: string;
  headline: string;
  bio: string;
  score: number;
  fund_signal: 'true' | 'false';
  trader_signal: 'true' | 'false';
  tradelayer_fit_signal: 'true' | 'false';
  likely_use_tradelayer: 'true' | 'false';
  matched_terms: string;
};

type VisionExtract = {
  headline: string;
  bio: string;
};

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      map.set(key, true);
      continue;
    }
    map.set(key, next);
    i += 1;
  }

  if (map.has('help')) {
    console.log(usage());
    process.exit(0);
  }

  const handlesFile = String(map.get('handles-file') || '').trim();
  if (!handlesFile) {
    throw new Error('Missing required --handles-file. Use --help for usage.');
  }

  const modeRaw = String(map.get('mode') || 'bio-only').toLowerCase();
  if (modeRaw !== 'bio-only' && modeRaw !== 'profile') {
    throw new Error('Invalid --mode. Expected bio-only or profile.');
  }

  const outBase = `x-tradelayer-fit-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outCsv = String(map.get('out-csv') || path.join('runs', `${outBase}.csv`));
  const outJson = String(map.get('out-json') || path.join('runs', `${outBase}.json`));
  const headless = String(map.get('headless') || 'true').toLowerCase() !== 'false';
  const gaitMs = Math.max(1000, Number(map.get('gait-ms') || 15000));
  const gaitMinMs = Math.max(1000, Number(map.get('gait-min-ms') || gaitMs));
  const gaitMaxMs = Math.max(gaitMinMs, Number(map.get('gait-max-ms') || gaitMs));
  const maxProfiles = Math.max(1, Number(map.get('max-profiles') || 5000));
  const apiKeyFile = map.get('api-key-file') ? String(map.get('api-key-file')) : undefined;
  const model = String(map.get('model') || process.env.OPENAI_MODEL || 'gpt-5-mini');
  const screenshotDir = String(map.get('screenshot-dir') || path.join('runs', 'x-tradelayer-shots'));

  return {
    handlesFile,
    outCsv,
    outJson,
    headless,
    mode: modeRaw,
    gaitMs,
    gaitMinMs,
    gaitMaxMs,
    maxProfiles,
    apiKeyFile,
    model,
    screenshotDir,
  };
}

function usage() {
  return [
    'Usage:',
    'npm run research:x-tradelayer -- --handles-file "C:\\path\\following.csv" --mode bio-only --gait-ms 15000',
    '',
    'Input file formats:',
    '- CSV headers accepted: handle|username|screen_name plus optional bio|bio_snippet|description',
    '- Newline text: one handle or x.com URL per line',
    '',
    'Options:',
    '--handles-file <path>    Required. Input list of handles.',
    '--mode <bio-only|profile> bio-only uses provided bio/snippet only; profile uses screenshots + OpenAI vision.',
    '--gait-ms <n>            Delay before each profile request (default: 15000).',
    '--gait-min-ms <n>        Randomized gait min delay (default: gait-ms).',
    '--gait-max-ms <n>        Randomized gait max delay (default: gait-ms).',
    '--max-profiles <n>       Max handles to process (default: 5000).',
    '--headless <bool>        true|false (default: true).',
    '--api-key-file <path>    Optional OpenAI key file. Falls back to OPENAI_API_KEY, then Desktop GPTAPI.txt.',
    '--model <id>             OpenAI model for vision extraction (default: gpt-5-mini).',
    '--screenshot-dir <path>  Where profile screenshots are saved (default: runs/x-tradelayer-shots).',
    '--out-csv <path>         Output CSV (default: runs/x-tradelayer-fit-*.csv).',
    '--out-json <path>        Output JSON (default: runs/x-tradelayer-fit-*.json).',
  ].join('\n');
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let curr = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        curr += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(curr);
      curr = '';
      continue;
    }
    curr += ch;
  }
  out.push(curr);
  return out.map((v) => v.trim());
}

function normalizeHandle(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  const maybeUrl = raw.match(/(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,15})/i)?.[1] || raw;
  return maybeUrl.replace(/^@/, '').trim().toLowerCase();
}

function parseInputProfiles(filePath: string, maxProfiles: number): InputProfile[] {
  const text = fs.readFileSync(filePath, 'utf-8');
  const trimmed = text.trim();
  if (!trimmed) return [];

  const deduped = new Map<string, InputProfile>();

  if (path.extname(filePath).toLowerCase() === '.csv' || trimmed.includes(',')) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return [];
    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const handleIdx = headers.findIndex((h) => ['handle', 'username', 'screen_name'].includes(h));
    const urlIdx = headers.findIndex((h) => ['profile_url', 'url', 'x_url'].includes(h));
    const bioIdx = headers.findIndex((h) => ['bio', 'bio_snippet', 'description'].includes(h));

    if (handleIdx >= 0 || urlIdx >= 0) {
      for (let i = 1; i < lines.length; i += 1) {
        const cells = parseCsvLine(lines[i]);
        const rawHandle = handleIdx >= 0 ? String(cells[handleIdx] || '') : String(cells[urlIdx] || '');
        const handle = normalizeHandle(rawHandle);
        if (!handle || deduped.has(handle)) continue;
        deduped.set(handle, {
          handle,
          profileUrl: `https://x.com/${handle}`,
          inputBio: bioIdx >= 0 ? String(cells[bioIdx] || '') : '',
        });
        if (deduped.size >= maxProfiles) break;
      }
      return Array.from(deduped.values());
    }
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const handle = normalizeHandle(line);
    if (!handle || deduped.has(handle)) continue;
    deduped.set(handle, {
      handle,
      profileUrl: `https://x.com/${handle}`,
      inputBio: '',
    });
    if (deduped.size >= maxProfiles) break;
  }
  return Array.from(deduped.values());
}

async function waitGait(gaitMs: number, label: string) {
  console.log(`[gait] ${label}: waiting ${gaitMs}ms`);
  await new Promise((resolve) => setTimeout(resolve, gaitMs));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeApiKey(raw: string): string {
  const oneLine = raw.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  return oneLine
    .replace(/^OPENAI_API_KEY\s*=\s*/i, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function resolveApiKeyFile(explicitPath?: string): string | undefined {
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;
  const userProfile = process.env.USERPROFILE || '';
  const candidates = [
    path.join(userProfile, 'OneDrive', 'Desktop', 'GPTAPI.txt'),
    path.join(userProfile, 'Desktop', 'GPTAPI.txt'),
    'C:\\Desktop\\GPTAPI.txt',
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function loadOpenAiApiKey(explicitPath?: string): string {
  const envKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (envKey) return envKey;

  const keyFile = resolveApiKeyFile(explicitPath);
  if (!keyFile) {
    throw new Error('No OpenAI key found. Set OPENAI_API_KEY or provide --api-key-file (for example Desktop GPTAPI.txt).');
  }

  const raw = fs.readFileSync(keyFile, 'utf-8');
  const key = normalizeApiKey(raw);
  if (!key) {
    throw new Error(`OpenAI key file is empty or invalid: ${keyFile}`);
  }
  return key;
}

function encodeImage(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
}

async function extractProfileTextFromScreenshot(
  apiKey: string,
  model: string,
  screenshotPath: string,
): Promise<VisionExtract> {
  const imageB64 = encodeImage(screenshotPath);
  const body = {
    model,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: 'Extract only public profile summary text from this X profile screenshot. Return strict JSON with keys: headline, bio. If uncertain, use empty string.'
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Return JSON only.'
          },
          {
            type: 'input_image',
            image_url: `data:image/png;base64,${imageB64}`
          }
        ]
      }
    ]
  };

  const res = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const json = await res.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const chunks: string[] = [];
  if (typeof json.output_text === 'string' && json.output_text.trim()) {
    chunks.push(json.output_text.trim());
  }
  const outItems = Array.isArray(json.output) ? json.output : [];
  for (const item of outItems) {
    const contentItems = Array.isArray(item.content) ? item.content : [];
    for (const c of contentItems) {
      if (typeof c?.text === 'string' && c.text.trim()) chunks.push(c.text.trim());
    }
  }
  const parsed = extractJsonObject(chunks.join('\n')) || {};
  const headline = String(parsed.headline || '').trim();
  const bio = String(parsed.bio || '').trim();
  return { headline, bio };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function writeCsv(filePath: string, rows: RankedLead[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const headers = [
    'handle',
    'profile_url',
    'headline',
    'bio',
    'score',
    'fund_signal',
    'trader_signal',
    'tradelayer_fit_signal',
    'likely_use_tradelayer',
    'matched_terms',
  ];
  const out = [headers.join(',')];
  for (const row of rows) {
    out.push([
      csvEscape(row.handle),
      csvEscape(row.profile_url),
      csvEscape(row.headline),
      csvEscape(row.bio),
      String(row.score),
      row.fund_signal,
      row.trader_signal,
      row.tradelayer_fit_signal,
      row.likely_use_tradelayer,
      csvEscape(row.matched_terms),
    ].join(','));
  }
  fs.writeFileSync(filePath, `${out.join('\n')}\n`, 'utf-8');
}

function scoreProfile(headline: string, bio: string): RankedLead['score'] extends number ? {
  score: number;
  matched: string[];
  fundSignal: boolean;
  traderSignal: boolean;
  fitSignal: boolean;
  likely: boolean;
} : never {
  const text = `${headline} ${bio}`.toLowerCase();

  const fundTerms = [
    'fund', 'capital', 'ventures', 'venture', 'vc', 'hedge', 'asset management',
    'investment', 'portfolio manager', 'market maker', 'liquidity provider', 'otc',
  ];
  const traderTerms = [
    'trader', 'trading', 'desk', 'quant', 'macro', 'futures', 'options',
    'perps', 'derivatives', 'execution',
  ];
  const fitTerms = [
    'bitcoin', 'btc', 'stablecoin', 'usdt', 'usdc', 'usd', 'settlement',
    'payments', 'treasury', 'rails', 'api', 'prime brokerage', 'institutional',
  ];
  const negativeTerms = ['artist', 'nft artist', 'giveaway', 'fan account', 'meme page'];

  const matched: string[] = [];
  let score = 0;

  const seen = new Set<string>();
  const hit = (term: string, weight: number) => {
    if (text.includes(term) && !seen.has(term)) {
      seen.add(term);
      matched.push(term);
      score += weight;
    }
  };

  for (const t of fundTerms) hit(t, 3);
  for (const t of traderTerms) hit(t, 2);
  for (const t of fitTerms) hit(t, 2);
  for (const t of negativeTerms) {
    if (text.includes(t)) {
      matched.push(`-${t}`);
      score -= 3;
    }
  }

  const fundSignal = fundTerms.some((t) => text.includes(t));
  const traderSignal = traderTerms.some((t) => text.includes(t));
  const fitSignal = fitTerms.some((t) => text.includes(t));
  const likely = score >= 6 && (fundSignal || traderSignal) && fitSignal;

  return { score, matched, fundSignal, traderSignal, fitSignal, likely };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.handlesFile)) {
    throw new Error(`Input file not found: ${args.handlesFile}`);
  }

  const input = parseInputProfiles(args.handlesFile, args.maxProfiles);
  if (input.length === 0) {
    throw new Error(`No handles parsed from input file: ${args.handlesFile}`);
  }

  let browserRows = new Map<string, { headline: string; bio: string }>();
  if (args.mode === 'profile') {
    const apiKey = loadOpenAiApiKey(args.apiKeyFile);
    fs.mkdirSync(args.screenshotDir, { recursive: true });
    const browser = await chromium.launch({ headless: args.headless });
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 1200 },
    });
    const page = await context.newPage();
    try {
      for (const profile of input) {
        const waitMs = randomInt(args.gaitMinMs, args.gaitMaxMs);
        await waitGait(waitMs, `before profile ${profile.handle}`);
        await page.goto(profile.profileUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
        await page.waitForTimeout(1200);

        const screenshotPath = path.join(args.screenshotDir, `${profile.handle}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

        const extracted = await extractProfileTextFromScreenshot(apiKey, args.model, screenshotPath)
          .catch(() => ({ headline: '', bio: '' }));
        browserRows.set(profile.handle, extracted);
      }
    } finally {
      await context.close();
      await browser.close();
    }
  }

  const ranked: RankedLead[] = input.map((profile) => {
    const fromProfile = browserRows.get(profile.handle);
    const headline = fromProfile?.headline || '';
    const bio = fromProfile?.bio || profile.inputBio || '';
    const scored = scoreProfile(headline, bio);
    return {
      handle: profile.handle,
      profile_url: profile.profileUrl,
      headline,
      bio,
      score: scored.score,
      fund_signal: scored.fundSignal ? 'true' : 'false',
      trader_signal: scored.traderSignal ? 'true' : 'false',
      tradelayer_fit_signal: scored.fitSignal ? 'true' : 'false',
      likely_use_tradelayer: scored.likely ? 'true' : 'false',
      matched_terms: scored.matched.join('|'),
    };
  });

  const shortlisted = ranked
    .filter((r) => r.likely_use_tradelayer === 'true')
    .sort((a, b) => b.score - a.score);

  fs.mkdirSync(path.dirname(args.outJson), { recursive: true });
  fs.writeFileSync(args.outJson, JSON.stringify({
    generated_at: new Date().toISOString(),
    mode: args.mode,
    gait_ms: args.gaitMs,
    input_count: input.length,
    shortlisted_count: shortlisted.length,
    shortlisted,
  }, null, 2), 'utf-8');
  writeCsv(args.outCsv, shortlisted);

  console.log(args.outCsv);
  console.log(args.outJson);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

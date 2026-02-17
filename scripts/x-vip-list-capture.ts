import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

type CliArgs = {
  listUrl: string;
  cdpUrl?: string;
  userDataDir: string;
  profileDir: string;
  cloneUserData: boolean;
  headless: boolean;
  loginWaitMs: number;
  visionRetries: number;
  visionTimeoutMs: number;
  maxMembers: number;
  maxScrolls: number;
  gaitMinMs: number;
  gaitMaxMs: number;
  apiKeyFile?: string;
  model: string;
  outDir: string;
};

type VisionExtract = {
  display_name: string;
  headline: string;
  bio: string;
  location: string;
  website: string;
  followers: string;
  following: string;
  verified: string;
};

type LeadRow = {
  handle: string;
  profile_url: string;
  display_name: string;
  headline: string;
  bio: string;
  location: string;
  website: string;
  followers: string;
  following: string;
  verified: string;
  screenshot_path: string;
  hnwi_flag: 'true' | 'false';
  score: number;
  fund_signal: 'true' | 'false';
  trader_signal: 'true' | 'false';
  tradelayer_fit_signal: 'true' | 'false';
  likely_use_tradelayer: 'true' | 'false';
  matched_terms: string;
  source_list_url: string;
  captured_at: string;
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

  const listUrl = String(map.get('list-url') || 'https://x.com/i/lists/1226917722665209856/members').trim();
  const cdpUrl = map.get('cdp-url') ? String(map.get('cdp-url')).trim() : undefined;
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\patri';
  const userDataDir = String(
    map.get('user-data-dir')
      || path.join(userProfile, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
  ).trim();
  const profileDir = String(map.get('profile-dir') || 'Default').trim();
  const cloneUserData = String(map.get('clone-user-data') || 'true').toLowerCase() !== 'false';
  const headless = String(map.get('headless') || 'false').toLowerCase() === 'true';
  const loginWaitMs = Math.max(0, Number(map.get('login-wait-ms') || 600000));
  const visionRetries = Math.max(0, Number(map.get('vision-retries') || 2));
  const visionTimeoutMs = Math.max(5000, Number(map.get('vision-timeout-ms') || 45000));

  const maxMembers = Math.max(1, Number(map.get('max-members') || 500));
  const maxScrolls = Math.max(10, Number(map.get('max-scrolls') || 1500));
  const gaitMinMs = Math.max(500, Number(map.get('gait-min-ms') || 3000));
  const gaitMaxMs = Math.max(gaitMinMs, Number(map.get('gait-max-ms') || 7000));
  const apiKeyFile = map.get('api-key-file') ? String(map.get('api-key-file')) : undefined;
  const model = String(map.get('model') || process.env.OPENAI_MODEL || 'gpt-5-mini');

  const outBase = `vip-list-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outDir = String(map.get('out-dir') || path.join('runs', outBase));

  return {
    listUrl,
    cdpUrl,
    userDataDir,
    profileDir,
    cloneUserData,
    headless,
    loginWaitMs,
    visionRetries,
    visionTimeoutMs,
    maxMembers,
    maxScrolls,
    gaitMinMs,
    gaitMaxMs,
    apiKeyFile,
    model,
    outDir,
  };
}

function usage() {
  return [
    'Usage:',
    'npm run research:x-vip-list -- --list-url "https://x.com/i/lists/<id>/members" [options]',
    '',
    'Options:',
    '--list-url <url>         X list members URL.',
    '--cdp-url <url>          Optional. Attach to an already-running Chrome via CDP (example: http://127.0.0.1:9222).',
    '--user-data-dir <dir>    Chrome user data dir (default: %USERPROFILE%\\AppData\\Local\\Google\\Chrome\\User Data).',
    '--profile-dir <name>     Profile directory name (default: Default).',
    '--clone-user-data <bool> true|false (default: true). Clones profile into run dir to satisfy Chrome debugging restrictions.',
    '--headless <bool>        true|false (default: false).',
    '--login-wait-ms <n>      If redirected to /i/flow/login, wait up to this long for manual login (default: 600000). Set 0 to fail fast.',
    '--vision-retries <n>     Vision extraction retries per screenshot (default: 2).',
    '--vision-timeout-ms <n>  Vision request timeout (default: 45000).',
    '--max-members <n>        Stop after collecting this many unique handles (default: 500).',
    '--max-scrolls <n>        Max scroll iterations while discovering members (default: 1500).',
    '--gait-min-ms <n>        Min wait between profile visits (default: 3000).',
    '--gait-max-ms <n>        Max wait between profile visits (default: 7000).',
    '--api-key-file <path>    OpenAI key file (default falls back to env, then Desktop GPTAPI.txt).',
    '--model <id>             OpenAI model (default: gpt-5-mini).',
    '--out-dir <dir>          Output directory (default: runs/vip-list-<ts>/).',
  ].join('\n');
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitMs(ms: number, label: string) {
  console.log(`[gait] ${label}: waiting ${ms}ms`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function dismissCookieBanner(page: any) {
  // X sometimes shows a cookie modal that blocks rendering + screenshots.
  const labels = ['Accept all cookies', 'Refuse non-essential cookies', 'Accept', 'I accept'];
  for (const name of labels) {
    try {
      const btn = page.getByRole('button', { name });
      if (await btn.count() > 0) {
        await btn.first().click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(600);
        return;
      }
    } catch {
      // ignore
    }
  }
}

async function waitForProfilePaint(page: any) {
  // Wait for profile header/bio area to exist. Don't block forever.
  const candidates = [
    '[data-testid="UserName"]',
    '[data-testid="UserDescription"]',
    'header',
  ];
  for (const sel of candidates) {
    try {
      await page.waitForSelector(sel, { timeout: 8000 });
      return;
    } catch {
      // try next
    }
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
  if (!key) throw new Error(`OpenAI key file is empty or invalid: ${keyFile}`);
  return key;
}

function encodeImage(filePath: string): string {
  return fs.readFileSync(filePath).toString('base64');
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

async function extractProfileTextFromScreenshot(
  apiKey: string,
  model: string,
  screenshotPath: string,
  timeoutMs: number,
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
            text: [
              'You are extracting public profile info from an X (Twitter) profile screenshot.',
              'Return strict JSON with keys:',
              'display_name, headline, bio, location, website, followers, following, verified.',
              'Use empty strings if not visible.',
              'followers/following should be raw text as shown (e.g., "12.3K"). verified should be "true" or "false" if obvious, else empty.',
            ].join('\n'),
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Return JSON only.' },
          { type: 'input_image', image_url: `data:image/png;base64,${imageB64}` },
        ],
      },
    ],
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: ac.signal,
  });
  clearTimeout(timer);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const json = await res.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  const chunks: string[] = [];
  if (typeof json.output_text === 'string' && json.output_text.trim()) chunks.push(json.output_text.trim());
  const outItems = Array.isArray(json.output) ? json.output : [];
  for (const item of outItems) {
    const contentItems = Array.isArray(item.content) ? item.content : [];
    for (const c of contentItems) {
      if (typeof c?.text === 'string' && c.text.trim()) chunks.push(c.text.trim());
    }
  }

  const rawText = chunks.join('\n').trim();
  const parsedObj = extractJsonObject(rawText);
  if (!parsedObj) {
    const preview = rawText ? rawText.slice(0, 900) : '<empty>';
    throw new Error(`Vision JSON parse failed (preview): ${preview}`);
  }
  const parsed = parsedObj;
  const get = (k: string) => String((parsed as any)[k] || '').trim();
  return {
    display_name: get('display_name'),
    headline: get('headline'),
    bio: get('bio'),
    location: get('location'),
    website: get('website'),
    followers: get('followers'),
    following: get('following'),
    verified: get('verified'),
  };
}

function scoreProfile(headline: string, bio: string) {
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

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function withRetries<T>(label: string, attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 0; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i >= attempts) break;
      const backoff = 900 * (i + 1);
      console.log(`[retry] ${label}: ${i + 1}/${attempts} failed, waiting ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function writeCsv(filePath: string, rows: LeadRow[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const headers: Array<keyof LeadRow> = [
    'handle',
    'profile_url',
    'display_name',
    'headline',
    'bio',
    'location',
    'website',
    'followers',
    'following',
    'verified',
    'screenshot_path',
    'hnwi_flag',
    'score',
    'fund_signal',
    'trader_signal',
    'tradelayer_fit_signal',
    'likely_use_tradelayer',
    'matched_terms',
    'source_list_url',
    'captured_at',
  ];
  const out = [headers.join(',')];
  for (const r of rows) {
    out.push(headers.map((h) => csvEscape(String((r as any)[h] ?? ''))).join(','));
  }
  fs.writeFileSync(filePath, `${out.join('\n')}\n`, 'utf-8');
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

function loadExistingHandlesFromCsv(csvPath: string): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(csvPath)) return out;
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return out;
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const handleIdx = headers.findIndex((h) => h === 'handle');
  if (handleIdx < 0) return out;
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const h = String(cells[handleIdx] || '').trim().toLowerCase();
    if (h) out.add(h);
  }
  return out;
}

function cloneChromeUserDataDir(srcUserDataDir: string, profileDirName: string, dstUserDataDir: string) {
  // Clone only what's needed for auth state, skipping large/volatile caches.
  fs.mkdirSync(dstUserDataDir, { recursive: true });

  const srcLocalState = path.join(srcUserDataDir, 'Local State');
  const dstLocalState = path.join(dstUserDataDir, 'Local State');
  if (fs.existsSync(srcLocalState)) fs.copyFileSync(srcLocalState, dstLocalState);

  const srcProfileDir = path.join(srcUserDataDir, profileDirName);
  const dstProfileDir = path.join(dstUserDataDir, profileDirName);
  if (!fs.existsSync(srcProfileDir)) {
    throw new Error(`Chrome profile dir not found: ${srcProfileDir}`);
  }

  const skipDirNames = new Set([
    'Cache',
    'Code Cache',
    'GPUCache',
    'ShaderCache',
    'GrShaderCache',
    'Service Worker',
    'OptimizationGuidePredictionModels',
    'DawnCache',
    'Crashpad',
  ]);

  fs.cpSync(srcProfileDir, dstProfileDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (src) => {
      const base = path.basename(src);
      if (skipDirNames.has(base)) return false;
      return true;
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outDir, { recursive: true });
  const shotsDir = path.join(args.outDir, 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const errorsPath = path.join(args.outDir, 'errors.log');
  const logError = (msg: string) => {
    fs.appendFileSync(errorsPath, `${new Date().toISOString()} ${msg}\n`, 'utf-8');
  };

  let userDataDirForRun = args.userDataDir;
  let context: any = null;
  let page: any = null;
  let connectedBrowser: any = null;
  const usingCdp = Boolean(args.cdpUrl);

  if (usingCdp) {
    connectedBrowser = await chromium.connectOverCDP(args.cdpUrl!);
    // For CDP, the remote Chrome already has contexts/pages.
    const contexts = connectedBrowser.contexts();
    context = contexts[0] || await connectedBrowser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 1400 } });
    const pages = context.pages();
    page = pages.find((p: any) => String(p.url() || '').includes('/i/lists/') && String(p.url() || '').includes('/members'))
      || pages.find((p: any) => String(p.url() || '').includes('x.com'))
      || pages[0]
      || await context.newPage();
  } else {
    if (args.cloneUserData) {
      userDataDirForRun = path.join(args.outDir, 'chrome-user-data');
      if (!fs.existsSync(userDataDirForRun) || fs.readdirSync(userDataDirForRun).length === 0) {
        console.log(`[profile] cloning "${args.profileDir}" into ${userDataDirForRun}`);
        cloneChromeUserDataDir(args.userDataDir, args.profileDir, userDataDirForRun);
      } else {
        console.log(`[profile] using existing cloned user-data-dir: ${userDataDirForRun}`);
      }
    }

    context = await chromium.launchPersistentContext(userDataDirForRun, {
      channel: 'chrome',
      headless: args.headless,
      locale: 'en-US',
      viewport: { width: 1280, height: 1400 },
      args: [`--profile-directory=${args.profileDir}`],
    });
    page = await context.newPage();
  }

  const runMeta = {
    generated_at: new Date().toISOString(),
    list_url: args.listUrl,
    user_data_dir: userDataDirForRun,
    profile_dir: args.profileDir,
    headless: args.headless,
    max_members: args.maxMembers,
    max_scrolls: args.maxScrolls,
    gait_min_ms: args.gaitMinMs,
    gait_max_ms: args.gaitMaxMs,
    model: args.model,
    vision_retries: args.visionRetries,
    vision_timeout_ms: args.visionTimeoutMs,
  };
  fs.writeFileSync(path.join(args.outDir, 'run.json'), JSON.stringify(runMeta, null, 2), 'utf-8');

  try {
    // If user already has the list page open (CDP case), reuse it. Otherwise navigate.
    const currentUrl = String(page.url() || '');
    if (!currentUrl.includes('/i/lists/') || !currentUrl.includes('/members')) {
      await page.goto(args.listUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
    await page.waitForTimeout(5000);
    await dismissCookieBanner(page);
    await page.screenshot({ path: path.join(args.outDir, '00-list.png'), fullPage: false }).catch(() => {});

    const landedUrl = page.url();
    if (landedUrl.includes('/i/flow/login')) {
      if (args.headless) {
        throw new Error(`Hit login wall in headless mode. Re-run with --headless false and complete login. Current URL: ${landedUrl}`);
      }
      if (args.loginWaitMs <= 0) {
        throw new Error(`Hit login wall. Re-run with --login-wait-ms 600000 and complete login. Current URL: ${landedUrl}`);
      }

      console.log(`[auth] redirected to login. Please complete login in the opened Chrome window (timeout ${args.loginWaitMs}ms).`);
      const start = Date.now();
      while (Date.now() - start < args.loginWaitMs) {
        await page.waitForTimeout(1500);
        const u = page.url();
        if (!u.includes('/i/flow/login')) break;
      }

      await page.screenshot({ path: path.join(args.outDir, '00-after-login.png'), fullPage: false }).catch(() => {});
      const after = page.url();
      if (after.includes('/i/flow/login')) {
        throw new Error(`Still on login wall after waiting ${args.loginWaitMs}ms. Current URL: ${after}`);
      }
    }

    const reserved = new Set([
      'i', 'home', 'explore', 'notifications', 'messages', 'search', 'settings',
      'login', 'signup', 'tos', 'privacy', 'account', 'compose', 'intent',
    ]);

    const handles = new Set<string>();
    let stagnant = 0;
    let prev = 0;
    for (let i = 0; i < args.maxScrolls && handles.size < args.maxMembers; i += 1) {
      const batch = await page.evaluate(() => {
        const out: string[] = [];
        const re = /^\/([A-Za-z0-9_]{1,15})$/;
        for (const a of Array.from(document.querySelectorAll('a[href]'))) {
          const href = (a.getAttribute('href') || '').trim();
          const m = href.match(re);
          if (!m) continue;
          out.push(m[1].toLowerCase());
        }
        return out;
      });
      for (const h of batch) {
        if (!h || reserved.has(h)) continue;
        handles.add(h);
      }

      if (handles.size === prev) stagnant += 1;
      else stagnant = 0;
      prev = handles.size;

      if (stagnant >= 8) break;
      await page.mouse.wheel(0, 2400);
      await page.waitForTimeout(900);
    }

    const handleList = Array.from(handles.values()).slice(0, args.maxMembers);
    fs.writeFileSync(path.join(args.outDir, 'handles.txt'), `${handleList.join('\n')}\n`, 'utf-8');
    console.log(`[members] discovered=${handleList.length} (cap=${args.maxMembers})`);

    const apiKey = loadOpenAiApiKey(args.apiKeyFile);

    const capturedAt = new Date().toISOString();
    const allRows: LeadRow[] = [];

    for (let idx = 0; idx < handleList.length; idx += 1) {
      const handle = handleList[idx];
      const wait = randomInt(args.gaitMinMs, args.gaitMaxMs);
      await waitMs(wait, `before profile ${handle} (${idx + 1}/${handleList.length})`);

      const profileUrl = `https://x.com/${handle}`;
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await dismissCookieBanner(page);
      await waitForProfilePaint(page);

      const screenshotPath = path.join(shotsDir, `${handle}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

      const extracted = await withRetries(`vision ${handle}`, args.visionRetries, async () => (
        extractProfileTextFromScreenshot(apiKey, args.model, screenshotPath, args.visionTimeoutMs)
      )).catch((e) => {
        const errMsg = e instanceof Error ? e.message : String(e);
        logError(`[vision] handle=${handle} screenshot=${screenshotPath} err=${errMsg}`);
        return {
          display_name: '',
          headline: '',
          bio: '',
          location: '',
          website: '',
          followers: '',
          following: '',
          verified: '',
        };
      });

      const scored = scoreProfile(extracted.headline, extracted.bio);
      allRows.push({
        handle,
        profile_url: profileUrl,
        display_name: extracted.display_name,
        headline: extracted.headline,
        bio: extracted.bio,
        location: extracted.location,
        website: extracted.website,
        followers: extracted.followers,
        following: extracted.following,
        verified: extracted.verified,
        screenshot_path: screenshotPath,
        hnwi_flag: 'true',
        score: scored.score,
        fund_signal: scored.fundSignal ? 'true' : 'false',
        trader_signal: scored.traderSignal ? 'true' : 'false',
        tradelayer_fit_signal: scored.fitSignal ? 'true' : 'false',
        likely_use_tradelayer: scored.likely ? 'true' : 'false',
        matched_terms: scored.matched.join('|'),
        source_list_url: args.listUrl,
        captured_at: capturedAt,
      });
    }

    const allCsv = path.join(args.outDir, 'vip-members-all.csv');
    writeCsv(allCsv, allRows);

    const tlRows = allRows
      .filter((r) => r.likely_use_tradelayer === 'true')
      .sort((a, b) => b.score - a.score);
    const tlCsv = path.join(args.outDir, 'vip-members-tradelayer-shortlist.csv');
    writeCsv(tlCsv, tlRows);

    // Cross-ref + append into a combined TradeLayer CSV (without overwriting existing artifacts).
    const existingMerged = path.join('runs', 'tradelayer-shortlist-from-recovery-continued-merged.csv');
    const existingHandles = loadExistingHandlesFromCsv(existingMerged);
    const novelTl = tlRows.filter((r) => !existingHandles.has(r.handle));

    const appendCsv = path.join(args.outDir, 'tradelayer-shortlist-with-vip-hnwi.csv');
    const combined = [
      ...(() => {
        if (!fs.existsSync(existingMerged)) return [] as LeadRow[];
        // Upcast the existing TradeLayer rows into LeadRow-ish objects (missing fields become empty).
        const text = fs.readFileSync(existingMerged, 'utf-8');
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) return [] as LeadRow[];
        const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
        const idx = (name: string) => headers.indexOf(name);
        const iHandle = idx('handle');
        const iUrl = idx('profile_url');
        const iHeadline = idx('headline');
        const iBio = idx('bio');
        const iScore = idx('score');
        const iFund = idx('fund_signal');
        const iTrader = idx('trader_signal');
        const iFit = idx('tradelayer_fit_signal');
        const iLikely = idx('likely_use_tradelayer');
        const iMatched = idx('matched_terms');
        const rows: LeadRow[] = [];
        for (let i = 1; i < lines.length; i += 1) {
          const cells = parseCsvLine(lines[i]);
          const handle = String(cells[iHandle] || '').trim().toLowerCase();
          if (!handle) continue;
          rows.push({
            handle,
            profile_url: String(cells[iUrl] || '').trim(),
            display_name: '',
            headline: String(cells[iHeadline] || '').trim(),
            bio: String(cells[iBio] || '').trim(),
            location: '',
            website: '',
            followers: '',
            following: '',
            verified: '',
            screenshot_path: '',
            hnwi_flag: 'false',
            score: Number(String(cells[iScore] || '0')),
            fund_signal: (String(cells[iFund] || 'false') as any),
            trader_signal: (String(cells[iTrader] || 'false') as any),
            tradelayer_fit_signal: (String(cells[iFit] || 'false') as any),
            likely_use_tradelayer: (String(cells[iLikely] || 'false') as any),
            matched_terms: String(cells[iMatched] || '').trim(),
            source_list_url: '',
            captured_at: '',
          });
        }
        return rows;
      })(),
      ...novelTl,
    ];

    combined.sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle));
    writeCsv(appendCsv, combined);

    fs.writeFileSync(path.join(args.outDir, 'summary.json'), JSON.stringify({
      ...runMeta,
      discovered_members: handleList.length,
      captured_rows: allRows.length,
      tradelayer_shortlist_rows: tlRows.length,
      novel_tradelayer_rows_vs_existing: novelTl.length,
      outputs: {
        all_csv: allCsv,
        tradelayer_shortlist_csv: tlCsv,
        tradelayer_combined_csv: appendCsv,
        handles_txt: path.join(args.outDir, 'handles.txt'),
      },
    }, null, 2), 'utf-8');

    console.log(allCsv);
    console.log(tlCsv);
    console.log(appendCsv);
  } finally {
    if (!usingCdp) {
      await context.close();
      return;
    }

    // Important: disconnect from CDP so Node can exit. This should not close Chrome itself.
    try { await connectedBrowser?.close?.(); } catch {}
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

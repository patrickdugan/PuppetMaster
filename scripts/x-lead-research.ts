import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

type Lead = {
  session_id: string;
  query: string;
  handle: string;
  profile_url: string;
  bio_snippet: string;
  matched_keywords: string;
  social_type: string;
  is_mutual: 'true' | 'false';
};

type ExternalTag = {
  handle: string;
  social_type: string;
  is_mutual: boolean;
};

type CliArgs = {
  query: string[];
  outCsv: string;
  pages: number;
  sessionCount: number;
  maxProfiles: number;
  headless: boolean;
  visitProfiles: boolean;
  keywords: string[];
  tagsCsv?: string;
  onlyMutual: boolean;
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

  const queryRaw = String(map.get('query') || '');
  const query = queryRaw.split('||').map((q) => q.trim()).filter(Boolean);
  if (query.length === 0 && !map.has('help')) {
    throw new Error('Missing required --query. Use --help for usage.');
  }

  const outCsv = String(
    map.get('out-csv')
      || path.join('runs', `x-leads-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`)
  );
  const pages = Math.max(1, Number(map.get('pages') || 1));
  const sessionCount = Math.max(1, Number(map.get('sessions') || 1));
  const maxProfiles = Math.max(1, Number(map.get('max-profiles') || 50));
  const headless = String(map.get('headless') || 'true').toLowerCase() !== 'false';
  const visitProfiles = String(map.get('visit-profiles') || 'true').toLowerCase() !== 'false';
  const keywords = String(map.get('keywords') || 'vc,trader,perps,defi,market maker')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const tagsCsv = map.get('tags-csv') ? String(map.get('tags-csv')) : undefined;
  const onlyMutual = Boolean(map.get('only-mutual'));

  return {
    query,
    outCsv,
    pages,
    sessionCount,
    maxProfiles,
    headless,
    visitProfiles,
    keywords,
    tagsCsv,
    onlyMutual,
  };
}

function usage() {
  return [
    'Usage:',
    'npm run research:x-leads -- --query "site:x.com \\"defi trader\\"||site:x.com \\"perps vc\\"" [options]',
    '',
    'Options:',
    '--out-csv <path>         Output CSV path (default in runs/)',
    '--pages <n>              Number of Google result pages per query (default: 1)',
    '--sessions <n>           Isolated browser contexts to run (default: 1)',
    '--max-profiles <n>       Max unique profiles to keep (default: 50)',
    '--headless <bool>        true|false (default: true)',
    '--visit-profiles <bool>  true|false, applies Gaussian wait before each profile visit (default: true)',
    '--keywords <csv>         Keyword list for tags (default: vc,trader,perps,defi,market maker)',
    '--tags-csv <path>        Optional CSV with handle/type data (following|follower|mutual)',
    '--only-mutual            Keep only mutual handles in final CSV (requires --tags-csv or inferred type)',
  ].join('\n');
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function boxMullerGaussian(): number {
  const u1 = Math.max(Math.random(), Number.EPSILON);
  const u2 = Math.max(Math.random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function weightedGaussianDelayMs(): number {
  // Weighted profile: mostly normal pace, occasional short/long waits.
  const bucketRoll = Math.random();
  const mean = bucketRoll < 0.7 ? 15000 : bucketRoll < 0.9 ? 12000 : 19000;
  const std = 3000;
  const raw = mean + boxMullerGaussian() * std;
  return Math.max(6000, Math.min(30000, Math.round(raw)));
}

async function waitWithGait(label: string) {
  const ms = weightedGaussianDelayMs();
  console.log(`[gait] ${label}: waiting ${ms}ms`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function humanScrollResults(page: Page) {
  const steps = randomInt(7, 16);
  for (let i = 0; i < steps; i += 1) {
    const delta = randomInt(180, 520);
    await page.mouse.wheel(0, delta);
    const pause = Math.max(120, Math.min(1300, 550 + boxMullerGaussian() * 220));
    await page.waitForTimeout(pause);
  }
}

async function maybeAcceptGoogleConsent(page: Page) {
  const selectors = [
    'button:has-text("I agree")',
    'button:has-text("Accept all")',
    'button:has-text("Accept")',
  ];
  for (const selector of selectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(700);
      return;
    }
  }
}

function normalizeXProfileUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (!(host === 'x.com' || host === 'www.x.com' || host === 'twitter.com' || host === 'www.twitter.com')) {
      return null;
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const handle = parts[0].replace(/^@/, '');
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(handle)) return null;
    return `https://x.com/${handle}`;
  } catch {
    return null;
  }
}

function extractHandle(profileUrl: string): string {
  const m = profileUrl.match(/x\.com\/([a-zA-Z0-9_]{1,15})$/i);
  return m?.[1]?.toLowerCase() || '';
}

async function extractResultsFromGoogle(page: Page): Promise<Array<{ url: string; snippet: string }>> {
  return page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('div.g, div[data-sokoban-container]'));
    const out: Array<{ url: string; snippet: string }> = [];
    for (const block of blocks) {
      const link = block.querySelector('a[href]') as HTMLAnchorElement | null;
      if (!link?.href) continue;
      const snippetNode = block.querySelector('[data-sncf], .VwiC3b, .IsZvec, .st, .MUxGbd');
      const snippet = (snippetNode?.textContent || '').replace(/\s+/g, ' ').trim();
      out.push({ url: link.href, snippet });
    }
    return out;
  });
}

async function runSearchSession(
  context: BrowserContext,
  sessionIndex: number,
  args: CliArgs
): Promise<Lead[]> {
  const page = await context.newPage();
  const sessionId = `session_${String(sessionIndex + 1).padStart(2, '0')}`;
  const map = new Map<string, Lead>();

  for (const query of args.query) {
    await page.goto('https://www.google.com/ncr', { waitUntil: 'domcontentloaded' });
    await maybeAcceptGoogleConsent(page);

    await page.locator('textarea[name="q"], input[name="q"]').first().fill(query);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');

    for (let p = 0; p < args.pages; p += 1) {
      await humanScrollResults(page);
      const results = await extractResultsFromGoogle(page);
      for (const item of results) {
        const normalized = normalizeXProfileUrl(item.url);
        if (!normalized) continue;
        const handle = extractHandle(normalized);
        if (!handle || map.has(handle)) continue;
        const matched = args.keywords.filter((k) => item.snippet.toLowerCase().includes(k));
        map.set(handle, {
          session_id: sessionId,
          query,
          handle,
          profile_url: normalized,
          bio_snippet: item.snippet,
          matched_keywords: matched.join('|'),
          social_type: '',
          is_mutual: 'false',
        });
        if (map.size >= args.maxProfiles) break;
      }
      if (map.size >= args.maxProfiles) break;

      const nextBtn = page.locator('#pnnext, a[aria-label="Next page"]').first();
      if (!await nextBtn.isVisible().catch(() => false)) break;
      await waitWithGait('before next Google page');
      await nextBtn.click();
      await page.waitForLoadState('domcontentloaded');
    }
    if (map.size >= args.maxProfiles) break;
  }

  if (args.visitProfiles) {
    for (const lead of map.values()) {
      await waitWithGait(`before profile navigation ${lead.handle}`);
      await page.goto(lead.profile_url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(randomInt(700, 2200));
    }
  }

  return Array.from(map.values());
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

function parseExternalTagsCsv(filePath: string): Map<string, ExternalTag> {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return new Map();

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const handleIdx = headers.findIndex((h) => h === 'handle' || h === 'username' || h === 'screen_name');
  const typeIdx = headers.findIndex((h) => h === 'type' || h === 'relation' || h === 'relationship');
  if (handleIdx < 0 || typeIdx < 0) return new Map();

  const out = new Map<string, ExternalTag>();
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const handleRaw = String(cells[handleIdx] || '').replace(/^@/, '').toLowerCase();
    const socialType = String(cells[typeIdx] || '').toLowerCase();
    if (!handleRaw) continue;
    const isMutual = socialType.includes('mutual');
    out.set(handleRaw, { handle: handleRaw, social_type: socialType, is_mutual: isMutual });
  }
  return out;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function writeLeadsCsv(filePath: string, leads: Lead[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const headers = [
    'session_id',
    'query',
    'handle',
    'profile_url',
    'bio_snippet',
    'matched_keywords',
    'social_type',
    'is_mutual',
  ];
  const rows = [headers.join(',')];
  for (const lead of leads) {
    rows.push([
      csvEscape(lead.session_id),
      csvEscape(lead.query),
      csvEscape(lead.handle),
      csvEscape(lead.profile_url),
      csvEscape(lead.bio_snippet),
      csvEscape(lead.matched_keywords),
      csvEscape(lead.social_type),
      csvEscape(lead.is_mutual),
    ].join(','));
  }
  fs.writeFileSync(filePath, `${rows.join('\n')}\n`, 'utf-8');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: args.headless });
  const allLeads: Lead[] = [];

  try {
    for (let i = 0; i < args.sessionCount; i += 1) {
      const context = await browser.newContext({
        viewport: { width: randomInt(1240, 1360), height: randomInt(680, 820) },
        locale: 'en-US',
      });
      try {
        const leads = await runSearchSession(context, i, args);
        allLeads.push(...leads);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const deduped = new Map<string, Lead>();
  for (const lead of allLeads) {
    if (!deduped.has(lead.handle)) deduped.set(lead.handle, lead);
  }
  const leads = Array.from(deduped.values());

  let tagsMap = new Map<string, ExternalTag>();
  if (args.tagsCsv) {
    if (!fs.existsSync(args.tagsCsv)) {
      throw new Error(`tags CSV not found: ${args.tagsCsv}`);
    }
    tagsMap = parseExternalTagsCsv(args.tagsCsv);
  }

  for (const lead of leads) {
    const external = tagsMap.get(lead.handle);
    if (external) {
      lead.social_type = external.social_type;
      lead.is_mutual = external.is_mutual ? 'true' : 'false';
      continue;
    }
    const inferred = `${lead.bio_snippet} ${lead.matched_keywords}`.toLowerCase();
    if (inferred.includes('mutual')) {
      lead.social_type = 'mutual';
      lead.is_mutual = 'true';
    }
  }

  const finalLeads = args.onlyMutual ? leads.filter((l) => l.is_mutual === 'true') : leads;
  writeLeadsCsv(args.outCsv, finalLeads);
  console.log(args.outCsv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';

type Mode = 'report' | 'queue' | 'watch' | 'founder-daily';

type CliArgs = {
  mode: Mode;
  runDir?: string;
  runsRoot: string;
  intervalSec: number;
  limit: number;
  dryRun: boolean;
  chatId?: string;
  token?: string;
  founderExoPath: string;
};

type CampaignRow = {
  handle: string;
  tier?: string;
  rank_score?: string;
  segment?: string;
  primary_angle?: string;
  proof_point?: string;
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
    printUsage();
    process.exit(0);
  }

  const modeRaw = String(map.get('mode') || 'report').toLowerCase();
  if (modeRaw !== 'report' && modeRaw !== 'queue' && modeRaw !== 'watch' && modeRaw !== 'founder-daily') {
    throw new Error('Invalid --mode. Expected report|queue|watch|founder-daily');
  }

  const runsRoot = String(
    map.get('runs-root') ||
      process.env.PM_RUNS_DIR ||
      path.join(process.cwd(), 'runs')
  );
  const intervalSec = Math.max(10, Number(map.get('interval-sec') || 300));
  const limit = Math.max(1, Number(map.get('limit') || 8));
  const dryRun = String(map.get('dry-run') || 'false').toLowerCase() === 'true';
  const runDirArg = map.get('run-dir') ? String(map.get('run-dir')) : undefined;
  const founderExoPath = String(
    map.get('founder-exo') ||
    process.env.PM_FOUNDER_EXO ||
    'C:\\projects\\CryptoCOO\\founderExo.md'
  );

  return {
    mode: modeRaw as Mode,
    runDir: runDirArg,
    runsRoot,
    intervalSec,
    limit,
    dryRun,
    chatId: process.env.TELEGRAM_CHAT_ID,
    token: process.env.TELEGRAM_BOT_TOKEN,
    founderExoPath,
  };
}

function printUsage() {
  console.log([
    'Usage:',
    '  npm run agent:telegram -- --mode report --run-dir "C:\\path\\to\\run"',
    '  npm run agent:telegram -- --mode queue --run-dir "C:\\path\\to\\run" --limit 10',
    '  npm run agent:telegram -- --mode watch --runs-root "C:\\projects\\PuppetMaster\\PuppetMaster\\runs" --interval-sec 300',
    '  npm run agent:telegram -- --mode founder-daily --founder-exo "C:\\projects\\CryptoCOO\\founderExo.md"',
    '',
    'Env vars:',
    '  TELEGRAM_BOT_TOKEN=123456:ABC...',
    '  TELEGRAM_CHAT_ID=<chat-id>',
    '  PM_FOUNDER_EXO=C:\\projects\\CryptoCOO\\founderExo.md',
    '',
    'Flags:',
    '  --dry-run true  Print messages instead of sending.',
  ].join('\n'));
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

function parseCsv<T = Record<string, string>>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let h = 0; h < headers.length; h += 1) {
      row[headers[h]] = values[h] ?? '';
    }
    rows.push(row);
  }
  return rows as T[];
}

function parseJsonFile(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const cleaned = raw.replace(/^\uFEFF/, '');
  return JSON.parse(cleaned);
}

function latestRunDir(runsRoot: string): string | null {
  if (!fs.existsSync(runsRoot)) return null;
  const dirs = fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('vip-list-'))
    .map((d) => path.join(runsRoot, d.name));
  if (!dirs.length) return null;
  dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0];
}

function resolveRunDir(args: CliArgs): string {
  if (args.runDir) return path.resolve(args.runDir);
  const latest = latestRunDir(args.runsRoot);
  if (!latest) throw new Error(`No vip-list-* run folder found in ${args.runsRoot}`);
  return latest;
}

async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  dryRun: boolean
) {
  if (dryRun) {
    console.log('\n[DRY RUN TELEGRAM MESSAGE]\n' + text + '\n');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
}

function buildReportMessage(runDir: string, limit: number): string {
  const summaryPath = path.join(runDir, 'campaign-summary.json');
  const topPath = path.join(runDir, 'campaign-top-priority.csv');

  let headline = `PuppetMaster run: ${path.basename(runDir)}`;
  let stats = '';
  if (fs.existsSync(summaryPath)) {
    try {
      const summary = parseJsonFile(summaryPath);
      stats = [
        `ranked=${summary?.input?.ranked_rows ?? '?'}`,
        `vip_shortlist=${summary?.input?.vip_shortlist_rows ?? '?'}`,
        `merged=${summary?.input?.merged_shortlist_rows ?? '?'}`,
        `tiers(A/B/C/D)=${summary?.tiers?.A ?? 0}/${summary?.tiers?.B ?? 0}/${summary?.tiers?.C ?? 0}/${summary?.tiers?.D ?? 0}`,
      ].join(' | ');
    } catch {
      stats = 'summary parse failed';
    }
  }

  const rows = parseCsv<CampaignRow>(topPath).slice(0, limit);
  const topLines = rows.map((r, i) => {
    const tier = r.tier || '?';
    const score = r.rank_score || '?';
    const seg = r.segment || '?';
    return `${i + 1}. @${r.handle} [${tier}] score=${score} seg=${seg}`;
  });

  return [headline, stats, '', 'Top leads:', ...topLines].filter(Boolean).join('\n');
}

function buildQueueMessage(runDir: string, limit: number): string {
  const queuePath = path.join(runDir, 'contact-first-outreach-queue.csv');
  const rows = parseCsv<Record<string, string>>(queuePath).slice(0, limit);
  if (!rows.length) {
    return `No contact-first queue rows found in ${path.basename(runDir)}.`;
  }
  const lines = rows.map((r, i) => {
    const email = r.emails_found || r.mailto_found || 'form-only';
    return `${i + 1}. @${r.handle} [${r.tier || '?'}] -> ${email}`;
  });
  return [
    `Contact-first queue: ${path.basename(runDir)}`,
    '',
    ...lines,
  ].join('\n');
}

function extractSection(md: string, title: string): string[] {
  const idx = md.indexOf(`## ${title}`);
  if (idx < 0) return [];
  const rest = md.slice(idx);
  const nextHeader = rest.indexOf('\n## ', 1);
  const chunk = nextHeader >= 0 ? rest.slice(0, nextHeader) : rest;
  return chunk
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .slice(0, 4)
    .map((l) => l.replace(/^- /, ''));
}

function buildFounderDailyMessage(founderExoPath: string): string {
  if (!fs.existsSync(founderExoPath)) {
    return `Founder daily: file not found at ${founderExoPath}`;
  }
  const md = fs.readFileSync(founderExoPath, 'utf-8').replace(/^\uFEFF/, '');
  const buildLoop = extractSection(md, '4.1 Build Loop (Daily)');
  const qaLoop = extractSection(md, '4.2 QA Loop (Daily/Pre-release)');
  const gtmLoop = extractSection(md, '4.3 GTM Loop (2-3x weekly)');
  const treasuryLoop = extractSection(md, '4.4 Treasury/Mission Loop (Weekly)');

  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `Founder Daily (${today})`,
    '',
    'Build focus:',
    ...(buildLoop.length ? buildLoop.map((x, i) => `${i + 1}. ${x}`) : ['1. Pick one reliability target and ship a verified fix.']),
    '',
    'QA focus:',
    ...(qaLoop.length ? qaLoop.map((x, i) => `${i + 1}. ${x}`) : ['1. Run release gates and capture artifacts.']),
    '',
    'GTM focus:',
    ...(gtmLoop.length ? gtmLoop.map((x, i) => `${i + 1}. ${x}`) : ['1. Advance contact-first outreach queue.']),
    '',
    'Mission/Treasury check:',
    ...(treasuryLoop.length ? treasuryLoop.map((x, i) => `${i + 1}. ${x}`) : ['1. Validate budget and mission commitments this week.']),
  ];
  return lines.join('\n');
}

async function runOnce(args: CliArgs, mode: Mode) {
  const token = args.token || '';
  const chatId = args.chatId || '';
  if (!args.dryRun && (!token || !chatId)) {
    throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (or use --dry-run true).');
  }

  let text: string;
  if (mode === 'founder-daily') {
    text = buildFounderDailyMessage(args.founderExoPath);
  } else {
    const runDir = resolveRunDir(args);
    text = mode === 'queue'
      ? buildQueueMessage(runDir, args.limit)
      : buildReportMessage(runDir, args.limit);
  }

  await sendTelegramMessage(token, chatId, text, args.dryRun);
}

async function watchLoop(args: CliArgs) {
  const statePath = path.join(args.runsRoot, '.telegram-agent-state.json');
  let lastRun = '';
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      lastRun = String(state.lastRun || '');
    } catch {
      lastRun = '';
    }
  }
  console.log(`[telegram-agent] watching ${args.runsRoot} every ${args.intervalSec}s`);

  while (true) {
    try {
      const latest = latestRunDir(args.runsRoot);
      if (latest && latest !== lastRun) {
        const localArgs: CliArgs = { ...args, runDir: latest };
        await runOnce(localArgs, 'report');
        lastRun = latest;
        fs.writeFileSync(statePath, JSON.stringify({ lastRun }, null, 2), 'utf-8');
        console.log(`[telegram-agent] announced ${path.basename(latest)}`);
      }
    } catch (err) {
      console.error('[telegram-agent] cycle error:', err);
    }
    await new Promise((resolve) => setTimeout(resolve, args.intervalSec * 1000));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.mode === 'watch') {
    await watchLoop(args);
    return;
  }
  await runOnce(args, args.mode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

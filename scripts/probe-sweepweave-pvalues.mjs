import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const sweepDir = 'C:/projects/sweepweave-ts/sweepweave-ts';
const reportDir = 'C:/projects/PuppetMaster/PuppetMaster/runs';
const outPath = path.join(reportDir, `sweepweave-pvalue-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

const files = [
  'C:/projects/GPTStoryworld/storyworlds/diplomacy/forecast_backstab_p.json',
  'C:/projects/GPTStoryworld/storyworlds/diplomacy/forecast_coalition_p.json',
  'C:/projects/GPTStoryworld/storyworlds/diplomacy/forecast_defection_p.json',
  'C:/projects/GPTStoryworld/storyworlds/england_to_france_honest_p.json',
  'C:/projects/GPTStoryworld/storyworlds/france_to_germany_machiavellian_p.json',
  'C:/projects/GPTStoryworld/storyworlds/france_germany_machiavellian_extended_p.json',
  'C:/projects/GPTStoryworld/storyworlds/russia_to_austria_grudger_p.json',
];

function waitForServer(url, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      try {
        const res = await fetch(url);
        if (res.ok) {
          clearInterval(timer);
          resolve(true);
        }
      } catch {
        // retry
      }
    }, 750);
  });
}

function startVite() {
  return spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
    cwd: sweepDir,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function detectViteUrl(logLines) {
  for (let i = logLines.length - 1; i >= 0; i -= 1) {
    const line = logLines[i];
    const m = line.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function loadStoryworld(page, baseUrl, filePath) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('button:has-text("File")').click(),
    page.locator('button:has-text("Load JSON")').click(),
  ]);
  await chooser.setFiles(filePath);
  await page.waitForTimeout(1200);
}

async function probeOne(page, filePath) {
  const item = { filePath, errors: [], pageErrors: [], warnings: [] };

  const consoleHandler = (msg) => {
    const t = msg.type();
    const text = msg.text();
    if (t === 'error') item.errors.push(text);
    if (t === 'warning') item.warnings.push(text);
  };
  const pageErrHandler = (err) => item.pageErrors.push(String(err));

  page.on('console', consoleHandler);
  page.on('pageerror', pageErrHandler);

  try {
    await loadStoryworld(page, globalThis.__SWEEP_URL__, filePath);

    await page.locator('button:has-text("Overview")').click();
    const title = await page.locator('.sw-content input[type="text"]').first().inputValue().catch(() => '');
    item.title = title;

    const metricValues = await page.locator('.sw-metric-value').allTextContents();
    item.metrics = {
      encounters: Number(metricValues?.[0] ?? 0),
      avgOptions: Number(metricValues?.[1] ?? 0),
      avgReactions: Number(metricValues?.[2] ?? 0),
      avgEffects: Number(metricValues?.[3] ?? 0),
      endings: Number(metricValues?.[4] ?? 0),
    };

    await page.locator('button:has-text("Rehearsal")').click();
    await page.locator('button:has-text("Refresh")').click();
    await page.waitForTimeout(600);

    const rows = page.locator('table.sw-rehearsal-table tbody tr');
    const rowCount = await rows.count();
    let unreachable = 0;
    for (let i = 0; i < rowCount; i += 1) {
      const cells = rows.nth(i).locator('td');
      const c = await cells.count();
      if (c >= 2) {
        const reachText = (await cells.nth(1).innerText()).trim();
        if (reachText === 'No') unreachable += 1;
      }
    }
    item.rehearsal = { rowCount, unreachable };

    await page.locator('button:has-text("Notable Outcome Index")').click();
    await page.waitForTimeout(200);
    item.outcomeRows = await page.locator('table.sw-rehearsal-table tbody tr').count();

    await page.locator('.sw-rehearsal-toolbar button:has-text("Play")').click();
    await page.waitForTimeout(700);
    await page.locator('.sw-rehearsal-toolbar button:has-text("Pause")').click().catch(async () => {
      await page.locator('.sw-rehearsal-toolbar button:has-text("Play")').click().catch(() => {});
    });

    item.loadOk = !!title && title !== 'Untitled Storyworld';
  } catch (err) {
    item.exception = String(err);
  } finally {
    page.off('console', consoleHandler);
    page.off('pageerror', pageErrHandler);
  }

  return item;
}

async function main() {
  fs.mkdirSync(reportDir, { recursive: true });
  const vite = startVite();
  const viteLogs = [];
  vite.stdout.on('data', (d) => viteLogs.push(String(d)));
  vite.stderr.on('data', (d) => viteLogs.push(String(d)));

  try {
    await waitForServer('http://127.0.0.1:5173');
    // Vite may shift ports if 5173/5174 are occupied.
    await new Promise((resolve) => setTimeout(resolve, 800));
    const detected = detectViteUrl(viteLogs);
    globalThis.__SWEEP_URL__ = detected || 'http://127.0.0.1:5173/';
    await waitForServer(globalThis.__SWEEP_URL__);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const results = [];

    for (const filePath of files) {
      results.push(await probeOne(page, filePath));
    }

    await browser.close();

    const report = {
      createdAt: new Date().toISOString(),
      sweepweaveUrl: globalThis.__SWEEP_URL__,
      files: results,
      viteLogTail: viteLogs.slice(-50),
    };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(outPath);
  } finally {
    vite.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

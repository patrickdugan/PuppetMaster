import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureDir, parseArgs } from './utils.js';
import { moduleCatalog } from './modules/catalog.js';

function makeRunId(moduleId) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `mission-${moduleId.replace(/[^a-z0-9_.-]/gi, '_')}-${ts}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const moduleId = String(args.module || '').trim();
  if (!moduleId) {
    console.error('Usage: npm run mission -- --module <module-id> [--url <url>] [--headful]');
    console.error(`Available modules: ${Object.keys(moduleCatalog).join(', ')}`);
    process.exit(1);
  }
  const mod = moduleCatalog[moduleId];
  if (!mod) {
    console.error(`Unknown module: ${moduleId}`);
    console.error(`Available modules: ${Object.keys(moduleCatalog).join(', ')}`);
    process.exit(1);
  }

  const runsRoot = process.env.PM_RUNS_DIR || path.join(process.cwd(), 'runs');
  const runId = makeRunId(moduleId);
  const outDir = path.join(runsRoot, runId);
  ensureDir(outDir);

  const consoleLogs = [];
  const errors = [];
  const start = new Date();

  const browser = await chromium.launch({ headless: !Boolean(args.headful) });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text() };
    consoleLogs.push(entry);
    if (msg.type() === 'error') errors.push(entry);
  });
  page.on('pageerror', (err) => errors.push({ type: 'pageerror', text: String(err) }));

  const ctx = {
    moduleId,
    targetUrl: args.url ? String(args.url) : mod.defaultUrl,
    page,
    outDir,
    async capture(name) {
      const p = path.join(outDir, name);
      await page.screenshot({ path: p, fullPage: true });
      return p;
    },
  };

  let findings = [];
  let artifacts = {};
  let status = 'pass';
  let fatalError = null;

  try {
    await mod.navigate(ctx);
    artifacts = await mod.collectArtifacts(ctx);
    findings = await mod.runChecks(ctx);
    if (findings.some((f) => f.status === 'fail')) status = 'fail';
    else if (findings.some((f) => f.status === 'warn')) status = 'warn';
  } catch (err) {
    status = 'fail';
    fatalError = String(err);
  } finally {
    await browser.close();
  }

  const summary = {
    schema_version: '1.0',
    run_id: runId,
    mission: moduleId,
    target: ctx.targetUrl,
    started_at: start.toISOString(),
    ended_at: new Date().toISOString(),
    result: status,
    checks: findings,
    metrics: {
      error_count: errors.length,
      warn_count: findings.filter((f) => f.status === 'warn').length,
      pass_count: findings.filter((f) => f.status === 'pass').length,
    },
    artifacts,
    runtime: {
      console_tail: consoleLogs.slice(-50),
      errors,
      fatal_error: fatalError,
    },
    next_actions: [
      status === 'pass' ? 'No blocking findings.' : 'Inspect screenshot and runtime errors.',
      'If auth-gated page is expected, re-run with authenticated browser session.',
    ],
  };

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  console.log(JSON.stringify({ run_id: runId, result: status, out_dir: outDir }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

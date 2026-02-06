import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ensureDir, parseArgs, normalizePath } from './utils.js';
import { loadMasterPrompt, encodeImage, callVisionJudge, parseJudgeResponse, writeRunArtifact } from './openai.js';

const args = parseArgs(process.argv);
const appPath = args.app ? normalizePath(args.app) : null;
if (!appPath) {
  console.error('Usage: npm run desktop:mission -- --app "C:\\path\\to\\App.exe" [--window-title "Title"] [--backend uia|win32] [--max-steps 3] [--max-minutes 5] [--judge]');
  process.exit(1);
}

const backend = args.backend || 'uia';
const windowTitle = args['window-title'] || '';
const appArgs = args['app-args'] || '';
const maxControls = Number(args['max-controls'] || 160);
const timeoutMs = Number(args['timeout-ms'] || 20000);
const settleMs = Number(args['settle-ms'] || 600);
const maxSteps = Number(args['max-steps'] || 3);
const maxMinutes = Number(args['max-minutes'] || 5);
const judge = args.judge === true || args.judge === 'true';

const runId = `mission-desktop-${crypto.randomBytes(4).toString('hex')}`;
const runsRoot = process.env.PM_RUNS_DIR || path.join(process.cwd(), 'runs');
const outDir = path.join(runsRoot, runId);
ensureDir(outDir);

const scriptPath = path.join(process.cwd(), 'scripts', 'desktop_probe.py');
const python = process.env.PM_PYTHON || 'python';

const startedAt = new Date().toISOString();
let lastProbe = null;
let step = 0;
let errors = 0;

const deadline = Date.now() + maxMinutes * 60 * 1000;
while (step < maxSteps && Date.now() < deadline) {
  step += 1;
  const result = spawnSync(
    python,
    [
      scriptPath,
      '--app', appPath,
      '--app-args', appArgs,
      '--backend', backend,
      '--window-title', windowTitle,
      '--out-dir', outDir,
      '--max-controls', String(maxControls),
      '--timeout-ms', String(timeoutMs),
      '--settle-ms', String(settleMs),
      '--close',
    ],
    { encoding: 'utf-8' }
  );

  if (result.error || result.status !== 0) {
    errors += 1;
    const msg = result.error?.message || result.stderr || result.stdout || 'Unknown error';
    writeRunArtifact(outDir, `step_${step}_error.txt`, msg);
    break;
  }

  const jsonPath = (result.stdout || '').trim();
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    errors += 1;
    writeRunArtifact(outDir, `step_${step}_error.txt`, 'Missing desktop_probe.json');
    break;
  }

  const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  lastProbe = payload;

  const stepSnapshot = {
    step,
    window_title: payload.window_title,
    control_count: payload.control_count,
    screenshot: payload.screenshot,
  };
  writeRunArtifact(outDir, `step_${step}.json`, JSON.stringify(stepSnapshot, null, 2));
}

let judgeText = '';
if (judge && lastProbe?.screenshot && fs.existsSync(lastProbe.screenshot)) {
  const masterPrompt = loadMasterPrompt(path.join(process.cwd(), 'master_prompt.md'));
  const img = encodeImage(lastProbe.screenshot);
  judgeText = await callVisionJudge({
    prompt: masterPrompt,
    images: [img],
    metadata: {
      mode: 'desktop-mission',
      app: appPath,
      window_title: lastProbe.window_title,
      control_count: lastProbe.control_count,
    }
  });
  writeRunArtifact(outDir, 'desktop_judge.txt', judgeText);
}

const endedAt = new Date().toISOString();
const summary = {
  run_id: runId,
  mission: 'desktop',
  target: appPath,
  started_at: startedAt,
  ended_at: endedAt,
  checks: [
    {
      name: 'window_detected',
      status: lastProbe ? 'pass' : 'fail',
      evidence: lastProbe?.screenshot ? [lastProbe.screenshot] : [],
    },
    {
      name: 'controls_visible',
      status: lastProbe && lastProbe.control_count > 0 ? 'pass' : 'warn',
      evidence: lastProbe?.screenshot ? [lastProbe.screenshot] : [],
    }
  ],
  metrics: {
    errors,
    steps_executed: step,
    control_count: lastProbe?.control_count ?? 0,
  },
  next_actions: [
    judgeText ? 'Review desktop_judge.txt for follow-up fixes.' : 'Re-run with --judge for vision review.'
  ]
};

writeRunArtifact(outDir, 'summary.json', JSON.stringify(summary, null, 2));

if (judgeText) {
  const parsed = parseJudgeResponse(judgeText);
  console.log(parsed.raw || 'No judge output');
} else {
  console.log(`Desktop mission complete. summary.json -> ${path.join(outDir, 'summary.json')}`);
}

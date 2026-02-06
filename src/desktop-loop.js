import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ensureDir, parseArgs, normalizePath } from './utils.js';
import { loadMasterPrompt, encodeImage, callVisionJudge, writeRunArtifact } from './openai.js';

const args = parseArgs(process.argv);
const appPath = args.app ? normalizePath(args.app) : null;
const goalPrompt = args.prompt || '';
if (!appPath || !goalPrompt) {
  console.error('Usage: npm run desktop:loop -- --app "C:\\path\\to\\App.exe" --prompt "Goal" [--project "C:\\path\\to\\repo"] [--window-title "Title"] [--max-steps 5] [--max-minutes 10]');
  process.exit(1);
}

const backend = args.backend || 'uia';
const windowTitle = args['window-title'] || '';
const appArgs = args['app-args'] || '';
const maxControls = Number(args['max-controls'] || 200);
const timeoutMs = Number(args['timeout-ms'] || 20000);
const settleMs = Number(args['settle-ms'] || 600);
const maxSteps = Number(args['max-steps'] || 5);
const maxMinutes = Number(args['max-minutes'] || 10);
const projectPath = args.project ? normalizePath(args.project) : '';

const runId = `loop-desktop-${crypto.randomBytes(4).toString('hex')}`;
const runsRoot = process.env.PM_RUNS_DIR || path.join(process.cwd(), 'runs');
const outDir = path.join(runsRoot, runId);
const resultsDir = path.join(outDir, 'results');
ensureDir(outDir);
ensureDir(resultsDir);

const scriptPath = path.join(process.cwd(), 'scripts', 'desktop_probe.py');
const python = process.env.PM_PYTHON || 'python';

const masterPrompt = loadMasterPrompt(path.join(process.cwd(), 'master_prompt.md'));
const startedAt = new Date().toISOString();
const deadline = Date.now() + maxMinutes * 60 * 1000;

const runMeta = {
  run_id: runId,
  mode: 'desktop-loop',
  target_app: appPath,
  project_path: projectPath,
  prompt: goalPrompt,
  started_at: startedAt,
  max_steps: maxSteps,
  max_minutes: maxMinutes,
  iterations: 0,
  wall_time_ms: 0,
  results_dir: resultsDir,
};

const runMetaPath = path.join(outDir, 'run.json');
writeRunArtifact(outDir, 'run.json', JSON.stringify(runMeta, null, 2));

let lastProbe = null;
let iteration = 0;
let errors = 0;

while (iteration < maxSteps && Date.now() < deadline) {
  iteration += 1;
  const iterStarted = Date.now();

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
    writeRunArtifact(resultsDir, `iter_${iteration}_error.txt`, msg);
    break;
  }

  const jsonPath = (result.stdout || '').trim();
  if (!jsonPath || !fs.existsSync(jsonPath)) {
    errors += 1;
    writeRunArtifact(resultsDir, `iter_${iteration}_error.txt`, 'Missing desktop_probe.json');
    break;
  }

  const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  lastProbe = payload;

  const screenshotPath = payload.screenshot;
  const img = screenshotPath ? encodeImage(screenshotPath) : null;
  const judgeText = await callVisionJudge({
    prompt: masterPrompt,
    images: img ? [img] : [],
    metadata: {
      mode: 'desktop-loop',
      app: appPath,
      project_path: projectPath,
      goal: goalPrompt,
      iteration,
      window_title: payload.window_title,
      control_count: payload.control_count,
      controls: payload.controls.slice(0, 80),
    }
  });

  const iterMs = Date.now() - iterStarted;
  const iterRecord = {
    iteration,
    started_at: new Date(iterStarted).toISOString(),
    duration_ms: iterMs,
    screenshot: screenshotPath,
    control_count: payload.control_count,
    judge_text: judgeText,
  };

  writeRunArtifact(resultsDir, `iter_${iteration}.json`, JSON.stringify(iterRecord, null, 2));
  writeRunArtifact(resultsDir, `iter_${iteration}_judge.txt`, judgeText);
}

const endedAt = new Date().toISOString();
runMeta.iterations = iteration;
runMeta.wall_time_ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
runMeta.ended_at = endedAt;
runMeta.errors = errors;
runMeta.last_window_title = lastProbe?.window_title || '';
runMeta.last_control_count = lastProbe?.control_count ?? 0;
writeRunArtifact(outDir, 'run.json', JSON.stringify(runMeta, null, 2));

console.log(`Desktop loop complete. run.json -> ${runMetaPath}`);

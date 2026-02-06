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
  console.error('Usage: npm run desktop:loop -- --app "C:\\path\\to\\App.exe" --prompt "Goal" [--project "C:\\path\\to\\repo"] [--window-title "Title"] [--framework godot|unity|electron|web|unknown] [--max-steps 5] [--max-minutes 10]');
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
const framework = (args.framework || 'unknown').toLowerCase();

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
  framework,
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
let lastActionsPath = '';

const actionPrompt = `You are a desktop QA agent. Given a screenshot and UIA control summary, propose the next 1-3 UI actions to progress the goal.\n\nReturn strict JSON with shape: {"actions":[{"type":"click"|"click_control"|"type_text"|"keypress","x":number,"y":number,"automation_id":string,"name":string,"control_type":string,"index":number,"text":string,"keys":string,"delay_ms":number,"reason":string}],"labels":["label1","label2"],"notes":"..."}.\n\nRules:\n- Coordinates must be in screenshot pixel space with top-left as (0,0).\n- Prefer click_control when UIA elements are obvious.\n- For keypress, use pywinauto send_keys format (e.g. "{ENTER}").\n- Only click visible, likely-interactive UI.\n- Keep actions minimal.`;

function frameworkGlobs(fr) {
  if (fr === 'godot') return ['*.gd', '*.tscn', '*.tres', '*.res'];
  if (fr === 'unity') return ['*.cs', '*.unity', '*.prefab', '*.asset'];
  if (fr === 'electron') return ['*.ts', '*.tsx', '*.js', '*.jsx', '*.html', '*.css', '*.json'];
  if (fr === 'web') return ['*.ts', '*.tsx', '*.js', '*.jsx', '*.html', '*.css', '*.json'];
  return ['*.ts', '*.tsx', '*.js', '*.jsx', '*.html', '*.css', '*.json', '*.gd', '*.tscn'];
}

function runRg(searchTerm) {
  if (!projectPath) return [];
  const globs = frameworkGlobs(framework);
  const args = ['-n', searchTerm, projectPath, ...globs.flatMap((g) => ['-g', g])];
  const result = spawnSync('rg', args, { encoding: 'utf-8' });
  if (result.status !== 0 && result.status !== 1) {
    return [];
  }
  const lines = (result.stdout || '').trim().split('\n').filter(Boolean);
  return lines.slice(0, 50);
}

while (iteration < maxSteps && Date.now() < deadline) {
  iteration += 1;
  const iterStarted = Date.now();

  const probeArgs = [
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
  ];
  if (lastActionsPath) {
    probeArgs.push('--actions-json', lastActionsPath);
  }

  const result = spawnSync(python, probeArgs, { encoding: 'utf-8' });

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
    prompt: `${masterPrompt}\n\n${actionPrompt}\n\nGOAL: ${goalPrompt}`,
    images: img ? [img] : [],
    metadata: {
      mode: 'desktop-loop',
      app: appPath,
      project_path: projectPath,
      goal: goalPrompt,
      iteration,
      window_title: payload.window_title,
      window_rect: payload.window_rect,
      control_count: payload.control_count,
      controls: payload.controls.slice(0, 80),
    }
  });

  let actionPayload = { actions: [], labels: [], notes: '' };
  try {
    actionPayload = JSON.parse(judgeText);
  } catch {
    actionPayload = { actions: [], labels: [], notes: 'Failed to parse JSON from vision.' };
  }

  const actionsPath = path.join(resultsDir, `iter_${iteration}_actions.json`);
  writeRunArtifact(resultsDir, `iter_${iteration}_judge.txt`, judgeText);
  writeRunArtifact(resultsDir, `iter_${iteration}_actions.json`, JSON.stringify(actionPayload, null, 2));
  lastActionsPath = actionsPath;

  const searchResults = [];
  if (Array.isArray(actionPayload.labels)) {
    for (const label of actionPayload.labels.slice(0, 6)) {
      const hits = runRg(String(label));
      if (hits.length) {
        searchResults.push({ label, hits });
      }
    }
  }
  if (searchResults.length) {
    writeRunArtifact(resultsDir, `iter_${iteration}_search.json`, JSON.stringify(searchResults, null, 2));
  }

  const iterMs = Date.now() - iterStarted;
  const iterRecord = {
    iteration,
    started_at: new Date(iterStarted).toISOString(),
    duration_ms: iterMs,
    screenshot: screenshotPath,
    control_count: payload.control_count,
    actions: actionPayload.actions || [],
    labels: actionPayload.labels || [],
    notes: actionPayload.notes || '',
  };

  writeRunArtifact(resultsDir, `iter_${iteration}.json`, JSON.stringify(iterRecord, null, 2));
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

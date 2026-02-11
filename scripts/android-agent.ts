import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

type CliArgs = {
  serial?: string;
  appId?: string;
  activity?: string;
  iterations: number;
  intervalSec: number;
  runsRoot: string;
  dryRun: boolean;
  startEmulator?: string;
  waitSec: number;
  adbBin: string;
  emulatorBin: string;
};

type Device = {
  serial: string;
  state: string;
  model?: string;
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

  return {
    serial: map.get('serial') ? String(map.get('serial')) : undefined,
    appId: map.get('app-id') ? String(map.get('app-id')) : undefined,
    activity: map.get('activity') ? String(map.get('activity')) : undefined,
    iterations: Math.max(1, Number(map.get('iterations') || 3)),
    intervalSec: Math.max(1, Number(map.get('interval-sec') || 5)),
    runsRoot: String(map.get('runs-root') || process.env.PM_RUNS_DIR || path.join(process.cwd(), 'runs')),
    dryRun: String(map.get('dry-run') || 'false').toLowerCase() === 'true',
    startEmulator: map.get('start-emulator') ? String(map.get('start-emulator')) : undefined,
    waitSec: Math.max(10, Number(map.get('wait-sec') || 90)),
    adbBin: String(map.get('adb-bin') || process.env.PM_ADB || 'adb'),
    emulatorBin: String(map.get('emulator-bin') || process.env.PM_ANDROID_EMULATOR || 'emulator'),
  };
}

function printUsage() {
  console.log([
    'Usage:',
    '  npm run agent:android -- --iterations 3 --interval-sec 5',
    '  npm run agent:android -- --serial emulator-5554 --app-id org.telegram.messenger --activity org.telegram.ui.LaunchActivity',
    '  npm run agent:android -- --start-emulator Pixel_7_API_34 --wait-sec 120',
    '',
    'Options:',
    '  --serial <id>             Target ADB serial (default: first connected device).',
    '  --app-id <pkg>            Android package to launch before capture.',
    '  --activity <name>         Optional activity (used with --app-id via am start -n).',
    '  --iterations <n>          Capture cycles (default: 3).',
    '  --interval-sec <n>        Delay between cycles (default: 5).',
    '  --runs-root <path>        Output root directory (default: PM_RUNS_DIR or ./runs).',
    '  --start-emulator <avd>    Start Android emulator AVD if no device is connected.',
    '  --wait-sec <n>            Device wait timeout seconds (default: 90).',
    '  --dry-run true            Write run artifacts without ADB operations.',
    '',
    'Env vars:',
    '  PM_ADB=<path-to-adb>',
    '  PM_ANDROID_EMULATOR=<path-to-emulator>',
  ].join('\n'));
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function tsStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCmd(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { encoding: 'utf-8' });
  return {
    ok: r.status === 0,
    code: r.status ?? -1,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

function listDevices(adb: string): Device[] {
  const r = runCmd(adb, ['devices', '-l']);
  if (!r.ok) return [];
  const lines = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Device[] = [];
  for (const line of lines) {
    if (line.startsWith('List of devices attached')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const state = parts[1];
    const modelToken = parts.find((p) => p.startsWith('model:'));
    out.push({ serial, state, model: modelToken ? modelToken.slice(6) : undefined });
  }
  return out.filter((d) => d.state === 'device');
}

function getProp(adb: string, serial: string, key: string): string {
  const r = runCmd(adb, ['-s', serial, 'shell', 'getprop', key]);
  return r.ok ? r.stdout : '';
}

function startEmulatorIfNeeded(bin: string, avd: string) {
  spawn(bin, ['-avd', avd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function waitForDevice(adb: string, waitSec: number, preferredSerial?: string): Promise<Device | null> {
  const deadline = Date.now() + waitSec * 1000;
  while (Date.now() < deadline) {
    const devices = listDevices(adb);
    if (preferredSerial) {
      const hit = devices.find((d) => d.serial === preferredSerial);
      if (hit) return hit;
    } else if (devices.length) {
      return devices[0];
    }
    await sleep(3000);
  }
  return null;
}

function writeJson(filePath: string, obj: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf-8');
}

async function main() {
  const args = parseArgs(process.argv);
  const runId = `android-agent-${tsStamp()}`;
  const outDir = path.join(args.runsRoot, runId);
  const shotsDir = path.join(outDir, 'shots');
  const dumpsDir = path.join(outDir, 'ui');
  ensureDir(outDir);
  ensureDir(shotsDir);
  ensureDir(dumpsDir);

  const runMeta: Record<string, unknown> = {
    run_id: runId,
    mode: 'android-agent-bootstrap',
    started_at: new Date().toISOString(),
    adb_bin: args.adbBin,
    emulator_bin: args.emulatorBin,
    serial_requested: args.serial || '',
    app_id: args.appId || '',
    activity: args.activity || '',
    iterations: args.iterations,
    interval_sec: args.intervalSec,
    dry_run: args.dryRun,
  };
  writeJson(path.join(outDir, 'run.json'), runMeta);

  if (args.dryRun) {
    const summary = {
      ...runMeta,
      result: 'dry_run',
      checks: [
        { name: 'adb_discovery', status: 'skipped' },
        { name: 'capture_cycles', status: 'skipped' },
      ],
      artifacts: {
        run_json: path.join(outDir, 'run.json'),
      },
      ended_at: new Date().toISOString(),
    };
    writeJson(path.join(outDir, 'summary.json'), summary);
    console.log(JSON.stringify({ run_id: runId, result: 'dry_run', out_dir: outDir }, null, 2));
    return;
  }

  const adbVersion = runCmd(args.adbBin, ['version']);
  if (!adbVersion.ok) {
    throw new Error(`ADB not available via "${args.adbBin}": ${adbVersion.stderr || adbVersion.stdout}`);
  }

  let selected = args.serial
    ? listDevices(args.adbBin).find((d) => d.serial === args.serial) || null
    : listDevices(args.adbBin)[0] || null;

  if (!selected && args.startEmulator) {
    startEmulatorIfNeeded(args.emulatorBin, args.startEmulator);
    selected = await waitForDevice(args.adbBin, args.waitSec, args.serial);
  }
  if (!selected) {
    throw new Error('No Android device/emulator available. Connect a device or pass --start-emulator <avd-name>.');
  }

  const serial = selected.serial;
  const model = getProp(args.adbBin, serial, 'ro.product.model');
  const release = getProp(args.adbBin, serial, 'ro.build.version.release');
  const sdk = getProp(args.adbBin, serial, 'ro.build.version.sdk');

  if (args.appId) {
    if (args.activity) {
      runCmd(args.adbBin, ['-s', serial, 'shell', 'am', 'start', '-n', `${args.appId}/${args.activity}`]);
    } else {
      runCmd(args.adbBin, ['-s', serial, 'shell', 'monkey', '-p', args.appId, '-c', 'android.intent.category.LAUNCHER', '1']);
    }
    await sleep(1500);
  }

  const captureLogs: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= args.iterations; i += 1) {
    const shotRemote = `/sdcard/pm-android-shot-${i}.png`;
    const dumpRemote = `/sdcard/pm-android-ui-${i}.xml`;
    const shotLocal = path.join(shotsDir, `iter_${i}.png`);
    const dumpLocal = path.join(dumpsDir, `iter_${i}.xml`);
    const focus = runCmd(args.adbBin, ['-s', serial, 'shell', 'dumpsys', 'window', 'windows']);
    const focusLine =
      focus.stdout
        .split(/\r?\n/)
        .find((l) => l.includes('mCurrentFocus') || l.includes('mFocusedApp')) || '';

    const sc1 = runCmd(args.adbBin, ['-s', serial, 'shell', 'screencap', '-p', shotRemote]);
    const sc2 = runCmd(args.adbBin, ['-s', serial, 'pull', shotRemote, shotLocal]);
    runCmd(args.adbBin, ['-s', serial, 'shell', 'rm', '-f', shotRemote]);

    const du1 = runCmd(args.adbBin, ['-s', serial, 'shell', 'uiautomator', 'dump', dumpRemote]);
    const du2 = runCmd(args.adbBin, ['-s', serial, 'pull', dumpRemote, dumpLocal]);
    runCmd(args.adbBin, ['-s', serial, 'shell', 'rm', '-f', dumpRemote]);

    captureLogs.push({
      iteration: i,
      focused_window: focusLine,
      screenshot_ok: sc1.ok && sc2.ok && fs.existsSync(shotLocal),
      ui_dump_ok: du1.ok && du2.ok && fs.existsSync(dumpLocal),
      screenshot: shotLocal,
      ui_dump: dumpLocal,
    });

    if (i < args.iterations) {
      await sleep(args.intervalSec * 1000);
    }
  }

  const failCount = captureLogs.filter((x) => !x.screenshot_ok || !x.ui_dump_ok).length;
  const summary = {
    schema_version: '1.0',
    run_id: runId,
    mission: 'android-agent-bootstrap',
    target: {
      serial,
      model,
      android_release: release,
      sdk,
      app_id: args.appId || '',
      activity: args.activity || '',
    },
    started_at: runMeta.started_at,
    ended_at: new Date().toISOString(),
    result: failCount === 0 ? 'pass' : 'warn',
    checks: [
      { name: 'adb_connected', status: 'pass' },
      { name: 'capture_cycles', status: failCount === 0 ? 'pass' : 'warn' },
    ],
    metrics: {
      iterations: args.iterations,
      failures: failCount,
    },
    artifacts: {
      shots_dir: shotsDir,
      ui_dir: dumpsDir,
      captures: captureLogs,
    },
    next_actions: [
      'Use screenshots and UI dumps to design Appium or desktop-loop actions.',
      'If app was not foregrounded, rerun with --app-id and optional --activity.',
    ],
  };
  writeJson(path.join(outDir, 'summary.json'), summary);
  console.log(JSON.stringify({ run_id: runId, result: summary.result, out_dir: outDir }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


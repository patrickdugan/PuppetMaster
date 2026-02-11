import fs from 'node:fs';
import path from 'node:path';

type CliArgs = {
  outDir: string;
  appId: string;
  activity: string;
  platformVersion: string;
  deviceName: string;
  automationName: string;
  noInstall: boolean;
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
    outDir: String(map.get('out-dir') || path.join(process.cwd(), 'mobile-appium')),
    appId: String(map.get('app-id') || 'org.telegram.messenger'),
    activity: String(map.get('activity') || 'org.telegram.ui.LaunchActivity'),
    platformVersion: String(map.get('platform-version') || '14'),
    deviceName: String(map.get('device-name') || 'AndroidDevice'),
    automationName: String(map.get('automation-name') || 'UiAutomator2'),
    noInstall: String(map.get('no-install') || 'true').toLowerCase() !== 'false',
  };
}

function printUsage() {
  console.log([
    'Usage:',
    '  npm run agent:android:scaffold -- --out-dir "C:\\projects\\PuppetMaster\\PuppetMaster\\mobile-appium" --app-id org.telegram.messenger --activity org.telegram.ui.LaunchActivity',
    '',
    'Options:',
    '  --out-dir <path>          Output scaffold directory.',
    '  --app-id <package>        Android package under test.',
    '  --activity <name>         Launch activity under test.',
    '  --platform-version <ver>  Android platform version (default: 14).',
    '  --device-name <name>      Device name for capabilities.',
    '  --automation-name <name>  Appium automationName (default: UiAutomator2).',
    '  --no-install true|false   Only scaffold files (default: true).',
  ].join('\n'));
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function write(filePath: string, content: string) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildPackageJson() {
  return JSON.stringify(
    {
      name: 'mobile-appium-scaffold',
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: {
        'appium:server': 'appium',
        'test:smoke': 'node tests/smoke.mjs',
      },
      dependencies: {
        webdriverio: '^9.0.0',
      },
      devDependencies: {
        appium: '^2.11.0',
      },
    },
    null,
    2
  );
}

function buildEnvExample(args: CliArgs) {
  return [
    `ANDROID_APP_ID=${args.appId}`,
    `ANDROID_APP_ACTIVITY=${args.activity}`,
    `ANDROID_PLATFORM_VERSION=${args.platformVersion}`,
    `ANDROID_DEVICE_NAME=${args.deviceName}`,
    `ANDROID_AUTOMATION_NAME=${args.automationName}`,
    'ANDROID_UDID=',
    'APPIUM_HOST=127.0.0.1',
    'APPIUM_PORT=4723',
  ].join('\n') + '\n';
}

function buildSmokeTest() {
  return `import fs from 'node:fs';
import path from 'node:path';
import { remote } from 'webdriverio';

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

const host = env('APPIUM_HOST', '127.0.0.1');
const port = Number(env('APPIUM_PORT', '4723'));
const appPackage = env('ANDROID_APP_ID', 'org.telegram.messenger');
const appActivity = env('ANDROID_APP_ACTIVITY', 'org.telegram.ui.LaunchActivity');
const platformVersion = env('ANDROID_PLATFORM_VERSION', '14');
const deviceName = env('ANDROID_DEVICE_NAME', 'AndroidDevice');
const automationName = env('ANDROID_AUTOMATION_NAME', 'UiAutomator2');
const udid = env('ANDROID_UDID', '');

const outDir = path.join(process.cwd(), 'runs', 'appium-smoke-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(outDir, { recursive: true });

const caps = {
  platformName: 'Android',
  'appium:automationName': automationName,
  'appium:deviceName': deviceName,
  'appium:platformVersion': platformVersion,
  'appium:appPackage': appPackage,
  'appium:appActivity': appActivity,
  'appium:noReset': true,
  'appium:newCommandTimeout': 180,
};

if (udid) caps['appium:udid'] = udid;

let client;
try {
  client = await remote({
    hostname: host,
    port,
    path: '/',
    capabilities: caps,
    logLevel: 'error',
  });

  await client.pause(3000);
  const source = await client.getPageSource();
  fs.writeFileSync(path.join(outDir, 'ui.xml'), source, 'utf-8');

  const shot = await client.takeScreenshot();
  fs.writeFileSync(path.join(outDir, 'screen.png'), Buffer.from(shot, 'base64'));

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
    result: 'pass',
    appPackage,
    appActivity,
    captured_at: new Date().toISOString(),
    artifacts: {
      ui: path.join(outDir, 'ui.xml'),
      screenshot: path.join(outDir, 'screen.png'),
    },
  }, null, 2), 'utf-8');

  console.log(JSON.stringify({ result: 'pass', out_dir: outDir }, null, 2));
} catch (err) {
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
    result: 'fail',
    error: String(err),
    captured_at: new Date().toISOString(),
  }, null, 2), 'utf-8');
  console.error(err);
  process.exitCode = 1;
} finally {
  if (client) {
    await client.deleteSession().catch(() => {});
  }
}
`;
}

function buildReadme() {
  return `# Mobile Appium Scaffold

Generated by \`npm run agent:android:scaffold\`.

## 1) Prerequisites

- Android SDK platform-tools (adb)
- Appium 2.x
- A running emulator or connected Android device with USB debugging on

## 2) Install

\`\`\`powershell
npm install
\`\`\`

Copy env template:

\`\`\`powershell
Copy-Item .env.example .env
\`\`\`

## 3) Start Appium

\`\`\`powershell
npm run appium:server
\`\`\`

## 4) Run Smoke Test

\`\`\`powershell
npm run test:smoke
\`\`\`

Artifacts:
- \`runs/appium-smoke-<ts>/summary.json\`
- \`runs/appium-smoke-<ts>/ui.xml\`
- \`runs/appium-smoke-<ts>/screen.png\`

## Integration With PuppetMaster

- Use \`npm run agent:android\` in repo root for ADB bootstrap captures.
- Use this scaffold for scripted interactions/assertions via Appium.
- Keep both outputs in your weekly QA evidence trail.
`;
}

async function main() {
  const args = parseArgs(process.argv);
  const outDir = path.resolve(args.outDir);

  ensureDir(outDir);
  write(path.join(outDir, 'package.json'), buildPackageJson());
  write(path.join(outDir, '.env.example'), buildEnvExample(args));
  write(path.join(outDir, 'tests', 'smoke.mjs'), buildSmokeTest());
  write(path.join(outDir, 'README.md'), buildReadme());

  const result: Record<string, unknown> = {
    result: 'scaffolded',
    out_dir: outDir,
    files: [
      path.join(outDir, 'package.json'),
      path.join(outDir, '.env.example'),
      path.join(outDir, 'tests', 'smoke.mjs'),
      path.join(outDir, 'README.md'),
    ],
  };

  if (!args.noInstall) {
    result.note = 'Scaffold created. Run npm install manually in out_dir.';
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


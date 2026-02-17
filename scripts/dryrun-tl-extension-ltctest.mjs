import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ensureDir, parseArgs, sleep } from '../src/utils.js';

function tsId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeCpDir(src, dst) {
  try {
    if (!fs.existsSync(src)) return { ok: false, reason: 'missing' };
    ensureDir(path.dirname(dst));
    fs.cpSync(src, dst, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

async function main() {
  // Support both `--key value` and positional legacy invocation.
  const args = parseArgs(process.argv);
  const positional = process.argv.slice(2).filter((x) => !String(x).startsWith('--'));
  const extDir = String(args.ext || 'C:\\projects\\TL Extension');
  // Use an HTML page by default so content scripts definitely run.
  // Note: the extension's `web_accessible_resources` currently only allow
  // `window.js` to be injected on the api/testnet-api subdomains.
  const url = String(args.url || positional[1] || 'https://testnet-api.layerwallet.com/');
  const network = String(args.network || positional[0] || 'LTCTEST').toUpperCase();
  const unlockPassword = args.unlockPassword ? String(args.unlockPassword) : null;
  const headful = args.headful !== false; // default true
  const channel = args.channel ? String(args.channel) : undefined; // default: bundled Chromium
  const profileDirectory = args.profileDirectory ? String(args.profileDirectory) : null;
  const cloneFromUserDataDir = args.cloneFromUserDataDir ? String(args.cloneFromUserDataDir) : null;
  const cloneFromProfileDirectory = args.cloneFromProfileDirectory
    ? String(args.cloneFromProfileDirectory)
    : 'Default';

  const runsRoot = process.env.PM_RUNS_DIR || path.join(process.cwd(), 'runs');
  const runId = `dryrun-tl-extension-${network}-${tsId()}`;
  const outDir = path.join(runsRoot, runId);
  ensureDir(outDir);

  // If the caller wants to use an existing Chrome/Chromium profile (so the wallet is already set up),
  // pass `--userDataDir "C:\\...\\User Data"` and optionally `--profileDirectory Default`.
  const userDataDir = args.userDataDir
    ? String(args.userDataDir)
    : path.join(outDir, 'chrome-user-data');
  ensureDir(userDataDir);

  const consoleLogs = [];
  const errors = [];

  const startedAt = new Date().toISOString();
  let result = 'fail';
  let accounts = null;
  let fatalError = null;
  let pageShot = null;
  let swAtStart = [];
  let swObserved = [];
  let extensionId = null;

  if (!fs.existsSync(extDir)) {
    throw new Error(`Extension dir not found: ${extDir}`);
  }

  const withTimeout = async (label, p, ms) => {
    return await Promise.race([
      p,
      sleep(ms).then(() => {
        throw new Error(`${label} timeout after ${ms}ms`);
      }),
    ]);
  };

  const serviceWorkers = [];
  let context = null;
  let page = null;
  const cloneNotes = [];

  try {
    // If requested, clone the existing extension's persisted storage from the user's Chrome profile
    // into this run's profile, so requestAccounts can succeed without manual onboarding.
    if (cloneFromUserDataDir) {
      const dstProfile = profileDirectory || 'Default';
      let extId = null;
      try {
        const tryFiles = ['Preferences', 'Secure Preferences'];
        for (const fn of tryFiles) {
          const prefsPath = path.join(cloneFromUserDataDir, cloneFromProfileDirectory, fn);
          if (!fs.existsSync(prefsPath)) continue;
          const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'));
          const settings = prefs?.extensions?.settings || {};
          for (const [id, v] of Object.entries(settings)) {
            if (v && String(v.path || '') === extDir) {
              extId = id;
              cloneNotes.push({ step: 'findExtIdByPath', ok: true, via: fn, id });
              break;
            }
          }
          if (extId) break;
        }
      } catch (e) {
        cloneNotes.push({ step: 'readPreferences', ok: false, error: String(e?.message || e) });
      }

      if (extId) {
        const srcBase = path.join(cloneFromUserDataDir, cloneFromProfileDirectory);
        const dstBase = path.join(userDataDir, dstProfile);

        const copies = [
          {
            kind: 'local_extension_settings',
            src: path.join(srcBase, 'Local Extension Settings', extId),
            dst: path.join(dstBase, 'Local Extension Settings', extId),
          },
          {
            kind: 'sync_extension_settings',
            src: path.join(srcBase, 'Sync Extension Settings', extId),
            dst: path.join(dstBase, 'Sync Extension Settings', extId),
          },
          {
            kind: 'indexeddb',
            src: path.join(srcBase, 'IndexedDB', `chrome-extension_${extId}_0.indexeddb.leveldb`),
            dst: path.join(dstBase, 'IndexedDB', `chrome-extension_${extId}_0.indexeddb.leveldb`),
          },
        ];

        for (const c of copies) {
          const r = safeCpDir(c.src, c.dst);
          cloneNotes.push({ ...c, ...r });
        }
      } else {
        cloneNotes.push({
          step: 'findExtIdByPath',
          ok: false,
          error: `No extension id found for path=${extDir} in Preferences/Secure Preferences`,
        });
      }
    }

    context = await withTimeout(
      'launchPersistentContext',
      chromium.launchPersistentContext(userDataDir, {
        headless: !headful,
        ...(channel ? { channel } : {}),
        viewport: { width: 1400, height: 900 },
        args: [
          `--disable-extensions-except=${extDir}`,
          `--load-extension=${extDir}`,
          ...(profileDirectory ? [`--profile-directory=${profileDirectory}`] : []),
          '--no-first-run',
          '--no-default-browser-check',
        ],
      }),
      45000
    );

    context.on('serviceworker', (w) => {
      try {
        serviceWorkers.push(w.url());
      } catch {}
    });

    page = await withTimeout('newPage', context.newPage(), 15000);
    context.setDefaultTimeout(30000);
    page.on('console', (msg) => {
      const entry = { type: msg.type(), text: msg.text() };
      consoleLogs.push(entry);
      if (msg.type() === 'error') errors.push(entry);
    });
    page.on('pageerror', (err) => errors.push({ type: 'pageerror', text: String(err) }));

    await sleep(750);
    swAtStart = context.serviceWorkers().map((w) => w.url());

    // Make sure we actually have an extension service worker before proceeding.
    await withTimeout(
      'waitForExtensionServiceWorker',
      (async () => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const urls = context.serviceWorkers().map((w) => w.url());
          if (urls.some((u) => String(u).startsWith('chrome-extension://'))) return true;
          await sleep(250);
        }
        throw new Error('No chrome-extension:// service worker observed (extension may not have loaded)');
      })(),
      20000
    );

    // Optional unlock flow for already-created wallets.
    // This fills the extension popup password prompt so requestAccounts can return an address.
    extensionId = (context.serviceWorkers().map((w) => w.url()).find((u) => String(u).startsWith('chrome-extension://')) || '')
      .replace('chrome-extension://', '')
      .split('/')[0] || null;
    if (unlockPassword && extensionId) {
      const popup = await withTimeout('openPopupPage', context.newPage(), 15000);
      const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
      await popup.goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      try {
        try {
          await popup.selectOption('select', network);
        } catch {}
        await popup.waitForSelector('input[type="password"]', { timeout: 5000 });
        await popup.fill('input[type="password"]', unlockPassword);
        await popup.click('button');
        await popup.waitForTimeout(1500);
      } catch (unlockErr) {
        console.warn('[dryrun] unlock step skipped:', String(unlockErr?.message || unlockErr));
      }
      await popup.close();
    }

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      pageShot = path.join(outDir, 'page-after-goto.png');
      await page.screenshot({ path: pageShot, fullPage: true });
    } catch {}

    // Give content scripts time to inject window.myWallet.
    await page.waitForFunction(() => {
      return !!(window.myWallet && typeof window.myWallet.requestAccounts === 'function');
    }, null, { timeout: 20000 });

    // Exercise the new network-aware request path.
    accounts = await page.evaluate(async (net) => {
      // Some sites may overwrite globals; keep this tight.
      const res = await window.myWallet.requestAccounts(net);
      return res;
    }, network);

    pageShot = path.join(outDir, 'page.png');
    await page.screenshot({ path: pageShot, fullPage: true });

    const expectedPrefix = network === 'LTCTEST' ? 'tltc' : 'ltc';
    const addr = accounts?.[0]?.address || accounts?.[0] || null;
    const ok =
      typeof addr === 'string' &&
      addr.toLowerCase().startsWith(expectedPrefix) &&
      (accounts?.[0]?.pubkey ? String(accounts[0].pubkey).length > 10 : true);

    result = ok ? 'pass' : 'fail';
    if (!ok) {
      throw new Error(`Unexpected accounts response for ${network}: ${JSON.stringify(accounts)}`);
    }
  } catch (err) {
    fatalError = String(err?.message || err);
  } finally {
    swObserved = (context?.serviceWorkers?.() || []).map((w) => w.url());
    try {
      if (page) {
        pageShot = pageShot || path.join(outDir, fatalError ? 'page-fail.png' : 'page-final.png');
        await page.screenshot({ path: pageShot, fullPage: true });
      }
    } catch {}

    // Let background scripts flush logs before closing.
    await sleep(250);
    try {
      if (context) {
        await Promise.race([
          context.close(),
          sleep(5000).then(() => {
            throw new Error('context.close timeout');
          }),
        ]);
      }
    } catch {}

    const summary = {
      schema_version: '1.1',
      mission: 'dryrun.tl-extension.ltctest',
      run_id: runId,
      target: url,
      extension_dir: extDir,
      requested_network: network,
      cloned_profile: cloneFromUserDataDir
        ? {
            from_user_data_dir: cloneFromUserDataDir,
            from_profile_directory: cloneFromProfileDirectory,
            to_user_data_dir: userDataDir,
            to_profile_directory: profileDirectory || 'Default',
            notes: cloneNotes,
          }
        : null,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      result,
      accounts,
      page_screenshot: pageShot,
      service_workers: {
        at_start: swAtStart,
        observed: serviceWorkers,
        at_end: swObserved,
      },
      runtime: {
        console_tail: consoleLogs.slice(-80),
        errors,
        fatal_error: fatalError,
      },
    };

    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    console.log(JSON.stringify({ run_id: runId, result, out_dir: outDir }, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

function parseArgs(argv) {
  const out = {
    addresses: null,
    outDir: null,
    year: 2025,
    headless: false,
    maxPages: 200,
    ps: 100,
    slowMoMs: 0,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--addresses") {
      out.addresses = v;
      i++;
    } else if (a === "--out") {
      out.outDir = v;
      i++;
    } else if (a === "--year") {
      out.year = Number(v);
      i++;
    } else if (a === "--headless") {
      out.headless = true;
    } else if (a === "--max-pages") {
      out.maxPages = Number(v);
      i++;
    } else if (a === "--ps") {
      out.ps = Number(v);
      i++;
    } else if (a === "--slowmo") {
      out.slowMoMs = Number(v);
      i++;
    }
  }
  if (!out.addresses || !out.outDir) {
    throw new Error('Usage: node scripts/scrape-etherscan-2025.mjs --addresses <csv|comma_addrs> --out <outdir> [--year 2025]');
  }
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readAddresses(addressesArg) {
  const trimmed = String(addressesArg || "").trim();
  if (trimmed.startsWith("0x") && trimmed.length === 42) return [trimmed.toLowerCase()];
  if (addressesArg.includes(",") && !addressesArg.toLowerCase().endsWith(".csv")) {
    return addressesArg
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.startsWith("0x") && s.length === 42);
  }
  if (!fs.existsSync(addressesArg)) throw new Error(`Addresses file not found: ${addressesArg}`);
  const raw = fs.readFileSync(addressesArg, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  const idxName = header.indexOf("Name");
  const idxAddr = header.indexOf("Address");
  const idxLatest = header.indexOf("Latest Transaction");
  const idxCnt = header.indexOf("Transactions Count");
  const out = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const name = (cols[idxName] || "").trim();
    const addr = (cols[idxAddr] || "").trim();
    const latest = (cols[idxLatest] || "").trim();
    const cnt = Number((cols[idxCnt] || "0").trim());
    if (name !== "eth") continue;
    if (!addr.startsWith("0x") || addr.length !== 42) continue;
    if (!latest.startsWith("2025-")) continue;
    if (!cnt) continue;
    out.push(addr.toLowerCase());
  }
  // de-dupe
  return [...new Set(out)];
}

function ymdInYear(ymd, year) {
  // ymd is "YYYY-MM-DD"
  return ymd && ymd.startsWith(String(year) + "-");
}

async function scrapeTable(page, tableSelector, rowMapper) {
  await page.waitForSelector(tableSelector, { timeout: 60000, state: "attached" });
  return await page.$$eval(`${tableSelector} tbody tr`, (rows, mapperSource) => {
    // eslint-disable-next-line no-new-func
    const mapper = new Function(`return (${mapperSource});`)();
    return rows.map((r) => mapper(r)).filter(Boolean);
  }, rowMapper.toString());
}

async function clickNextIfPresent(page) {
  // Etherscan uses paging controls; look for a "Next" button/link that is not disabled.
  const next = page.locator('a.page-link:has-text("Next")').first();
  if (await next.count()) {
    const cls = (await next.getAttribute("class")) || "";
    if (cls.includes("disabled")) return false;
    await next.click();
    await page.waitForLoadState("domcontentloaded");
    return true;
  }
  return false;
}

async function scrapeEtherscanList({ page, url, year, kind, maxPages, ps, screenshotsDir }) {
  // kind: txs | tokentxns | txsInternal
  const results = [];

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("table tbody tr", { timeout: 60000, state: "attached" });
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.screenshot({ path: path.join(screenshotsDir, `${kind}-page1.png`), fullPage: true });

  const tableSel = "table";

  const mapper = (row) => {
    const tds = Array.from(row.querySelectorAll("td")).map((td) => td.innerText.trim());

    const hashLink = row.querySelector('a[href^="/tx/"], a[href*="/tx/"]');
    let hash = null;
    if (hashLink) {
      const href = hashLink.getAttribute("href") || "";
      const m = href.match(/\/tx\/(0x[a-fA-F0-9]{64})/);
      if (m) hash = m[1];
      else hash = (hashLink.textContent || "").trim() || null;
    }
    if (!hash) {
      const h = tds.find((s) => /^0x[a-fA-F0-9]{64}$/.test(s));
      hash = h || null;
    }

    // Etherscan often renders a hidden UTC timestamp and unix timestamp in the "Age" column.
    // Derive "YYYY-MM-DD" from any cell that looks like a UTC datetime or unix seconds.
    let ymd = "";
    for (const cell of tds) {
      const m = cell.match(/(\d{4}-\d{2}-\d{2})/);
      if (m) {
        ymd = m[1];
        break;
      }
    }
    if (!ymd) {
      const unix = tds.find((s) => /^\d{10}$/.test(s));
      if (unix) {
        const ms = Number(unix) * 1000;
        if (Number.isFinite(ms)) ymd = new Date(ms).toISOString().slice(0, 10);
      }
    }
    return { hash, ymd, cols: tds };
  };

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const rows = await scrapeTable(page, tableSel, mapper);
    if (!rows.length) break;

    let sawTargetYear = false;
    let sawOlderThanYear = false;

    for (const r of rows) {
      const ymd = r.ymd || "";
      if (ymdInYear(ymd, year)) {
        sawTargetYear = true;
        results.push(r);
      } else if (ymd && ymd < `${year}-01-01`) {
        sawOlderThanYear = true;
      }
    }

    // If this page has no rows in the year and we already saw older-than-year timestamps, stop.
    if (!sawTargetYear && sawOlderThanYear) break;

    const moved = await clickNextIfPresent(page);
    if (!moved) break;
    await page.waitForTimeout(500);
  }

  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  const addresses = readAddresses(args.addresses);
  if (!addresses.length) throw new Error("No addresses selected.");

  const outDir = path.resolve(args.outDir);
  ensureDir(outDir);

  const browser = await chromium.launch({
    headless: args.headless,
    slowMo: args.slowMoMs || 0,
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  const summary = [];

  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    const addrDir = path.join(outDir, addr);
    const screenshotsDir = path.join(addrDir, "screens");
    ensureDir(screenshotsDir);

    const base = `https://etherscan.io`;
    const urls = {
      txs: `${base}/txs?a=${addr}&ps=${args.ps}&p=1`,
      tokentxns: `${base}/tokentxns?a=${addr}&ps=${args.ps}&p=1`,
      txsInternal: `${base}/txsInternal?a=${addr}&ps=${args.ps}&p=1`,
    };

    // Some pages can redirect to a "verify you are human" challenge. Capture a screenshot for evidence.
    console.log(`[${i + 1}/${addresses.length}] ${addr}`);

    const txs = await scrapeEtherscanList({
      page,
      url: urls.txs,
      year: args.year,
      kind: "txs",
      maxPages: args.maxPages,
      ps: args.ps,
      screenshotsDir,
    });

    const tokentxns = await scrapeEtherscanList({
      page,
      url: urls.tokentxns,
      year: args.year,
      kind: "tokentxns",
      maxPages: args.maxPages,
      ps: args.ps,
      screenshotsDir,
    });

    const txsInternal = await scrapeEtherscanList({
      page,
      url: urls.txsInternal,
      year: args.year,
      kind: "txsInternal",
      maxPages: args.maxPages,
      ps: args.ps,
      screenshotsDir,
    });

    fs.writeFileSync(path.join(addrDir, "txs_2025.json"), JSON.stringify(txs, null, 2));
    fs.writeFileSync(path.join(addrDir, "tokentxns_2025.json"), JSON.stringify(tokentxns, null, 2));
    fs.writeFileSync(path.join(addrDir, "txsInternal_2025.json"), JSON.stringify(txsInternal, null, 2));

    summary.push({
      address: addr,
      txs: txs.length,
      tokentxns: tokentxns.length,
      internal: txsInternal.length,
    });
  }

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ year: args.year, summary }, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

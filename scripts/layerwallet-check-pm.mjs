
import path from  node:path;
import fs from  node:fs;
import { chromium } from  playwright;

const outDir =  C:/projects/PuppetMaster/PuppetMaster/codex-chat-sessions/tmp;
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: false, channel:  chrome });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(" https://layerwallet.com\, { waitUntil: \domcontentloaded\, timeout: 60000 });

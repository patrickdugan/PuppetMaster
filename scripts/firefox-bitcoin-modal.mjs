import fs from 'node:fs';
import path from 'node:path';
import { firefox } from 'playwright';
import { encodeImage, callVisionJudge } from '../src/openai.js';

const url = process.env.TL_URL || 'http://localhost:8080';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const runsRoot = process.env.PM_RUNS_DIR || path.join(process.cwd(), 'runs');
const outDir = path.join(runsRoot, `firefox-fix-${runId}`);
fs.mkdirSync(outDir, { recursive: true });

const metaPrompt = `Task: Validate Firefox behavior for the Bitcoin network modal in TL-Web.\n- Open app at ${url}.\n- Click the Bitcoin logo (network button) to open the Select Network modal.\n- Ensure the modal and dropdown options are visible and the cancel button works.\n- Capture screenshots and call GPT-5-mini vision for descriptions to guide navigation.\n`;
fs.writeFileSync(path.join(outDir, 'meta_prompt.txt'), metaPrompt, 'utf-8');

const describePrompt = `You are a UI assistant. Describe what you see in this screenshot.\nFocus on:\n- Whether a modal is open (title text).\n- Whether a dropdown is open and options are visible.\n- Presence and visibility of Cancel/Select buttons.\nKeep it concise.`;

async function describeImage(pngPath, name) {
  const img = encodeImage(pngPath);
  const text = await callVisionJudge({
    prompt: describePrompt,
    images: [img],
    metadata: { url, name }
  });
  fs.writeFileSync(path.join(outDir, `${name}.vision.txt`), text, 'utf-8');
  return text;
}

async function capture(page, name) {
  const filePath = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

(async () => {
  const browser = await firefox.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const consoleLogs = [];
  page.on('console', (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => {
    consoleLogs.push({ type: 'pageerror', text: String(err) });
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const beforePath = await capture(page, '01-before');
  await describeImage(beforePath, '01-before');

  const networkBtn = page.locator('button.network-btn[aria-label="Switch network"]');
  await networkBtn.waitFor({ state: 'visible', timeout: 15000 });
  await networkBtn.click();

  const dialog = page.locator('mat-dialog-container, .mat-dialog-container');
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
  const dialogHtml = await page.evaluate(() => {
    const el = document.querySelector('mat-dialog-container, .mat-dialog-container');
    return el ? el.innerHTML.slice(0, 2000) : null;
  });

  const modalPath = await capture(page, '02-modal-open');
  await describeImage(modalPath, '02-modal-open');

  const selectTrigger = page.locator('mat-select');
  const nativeSelect = page.locator('select.native-select');
  const userAgent = await page.evaluate(() => navigator.userAgent);
  await page.evaluate(() => {
    const el = document.querySelector('mat-select');
    if (!el) return;
    (window).__pm_clicks = { selectClicks: 0 };
    el.addEventListener('click', () => {
      (window).__pm_clicks.selectClicks += 1;
    });
  });
  const matSelectInfo = await page.evaluate(() => {
    const el = document.querySelector('mat-select');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const trigger = el.querySelector('.mat-select-trigger');
    const triggerStyle = trigger ? getComputedStyle(trigger) : null;
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      ariaDisabled: el.getAttribute('aria-disabled'),
      className: el.className,
      display: style.display,
      visibility: style.visibility,
      pointerEvents: style.pointerEvents,
      triggerPointerEvents: triggerStyle?.pointerEvents ?? null,
      triggerDisplay: triggerStyle?.display ?? null,
    };
  });
  const matSelectCount = await selectTrigger.count();
  const nativeSelectCount = await nativeSelect.count();
  const useNative = nativeSelectCount > 0;
  let panelAppeared = false;
  let selectionError = null;
  if (useNative) {
    try {
      await page.waitForFunction(() => {
        return document.querySelectorAll('select.native-select option').length > 0;
      }, null, { timeout: 3000 });
    } catch {}
    await page.waitForTimeout(300);
  } else if (matSelectCount > 0) {
    await page.locator('mat-select .mat-select-trigger').click({ force: true });
    try {
      await page.waitForSelector('.mat-select-panel', { state: 'attached', timeout: 800 });
      panelAppeared = true;
    } catch {}
    await page.waitForTimeout(600);
  } else {
    selectionError = 'No mat-select or native select found in modal';
  }

  const dropdownPath = await capture(page, '03-dropdown-open');
  await describeImage(dropdownPath, '03-dropdown-open');

  const optionCount = await page.locator('.mat-select-panel .mat-option').count();
  const panelCount = await page.locator('.mat-select-panel').count();
  const nativeOptionCount = await nativeSelect.locator('option').count();
  const panelInfo = await page.evaluate(() => {
    const panel = document.querySelector('.mat-select-panel');
    if (!panel) return null;
    const rect = panel.getBoundingClientRect();
    return {
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: getComputedStyle(panel).display,
      visibility: getComputedStyle(panel).visibility,
      opacity: getComputedStyle(panel).opacity,
    };
  });
  const optionTexts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.mat-select-panel .mat-option')).map((el) => el.textContent?.trim()).filter(Boolean);
  });
  const nativeOptionTexts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('select.native-select option')).map((el) => el.textContent?.trim()).filter(Boolean);
  });

  let cancelClosed = false;
  const cancelButton = page.locator('button', { hasText: 'Cancel' });
  if (await cancelButton.isVisible().catch(() => false)) {
    await cancelButton.click({ force: true }).catch(() => {});
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent || '').trim().toLowerCase() === 'cancel'
      );
      if (btn) btn.click();
    }).catch(() => {});
    try {
      await dialog.waitFor({ state: 'hidden', timeout: 10000 });
      cancelClosed = true;
    } catch {}
  }
  const afterCancelPath = await capture(page, '04-after-cancel');
  await describeImage(afterCancelPath, '04-after-cancel');
  const cancelVisible = await page.locator('button', { hasText: 'Cancel' }).isVisible().catch(() => false);
  const clickInfo = await page.evaluate(() => (window).__pm_clicks || null);

  const dialogAfterCancel = await page.evaluate(() => {
    const el = document.querySelector('mat-dialog-container, .mat-dialog-container');
    if (!el) return null;
    const style = getComputedStyle(el);
    return { display: style.display, visibility: style.visibility, opacity: style.opacity };
  });
  const dialogCountAfterCancel = await page.evaluate(() => {
    return document.querySelectorAll('mat-dialog-container, .mat-dialog-container').length;
  });

  const summary = {
    optionCount,
    panelCount,
    panelInfo,
    optionTexts,
    nativeOptionCount,
    nativeOptionTexts,
    matSelectInfo,
    clickInfo,
    panelAppeared,
    useNative,
    userAgent,
    matSelectCount,
    nativeSelectCount,
    selectionError,
    dialogHtml,
    cancelVisible,
    cancelClosed,
    dialogAfterCancel,
    dialogCountAfterCancel,
    url,
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  fs.writeFileSync(path.join(outDir, 'console.json'), JSON.stringify(consoleLogs, null, 2), 'utf-8');

  await browser.close();
})();

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadMasterPrompt, encodeImage, callVisionJudge, parseJudgeResponse, writeRunArtifact, randomId } from './openai.js';
import { ensureDir, waitForUrl, listInteractiveSelectors, parseArgs, normalizePath } from './utils.js';
import { startStaticServer } from './staticServer.js';
import { startCommand, stopCommand } from './process.js';

const args = parseArgs(process.argv);
const target = args.target ? normalizePath(args.target) : null;
if (!target) {
  console.error('Usage: npm run qa -- --target <path> [--mode vite|static|webpack] [--url http://localhost:5173] [--cmd "npm run dev"]');
  process.exit(1);
}

const mode = args.mode || 'static';
const url = args.url || 'http://localhost:4173';
const cmd = args.cmd || (mode === 'webpack' ? 'npm run start' : 'npm run dev');
const maxDepth = Number(args.depth || 2);
const maxIterations = Number(args.iterations || 3);

const runId = randomId();
const runsRoot = process.env.PM_RUNS_DIR || path.join(process.cwd(), 'runs');
const outDir = path.join(runsRoot, runId);
ensureDir(outDir);

const masterPrompt = loadMasterPrompt(path.join(process.cwd(), 'master_prompt.md'));

let server = null;
let child = null;

async function startTarget() {
  if (mode === 'vite' || mode === 'webpack') {
    child = startCommand(cmd, path.dirname(target));
    const ok = await waitForUrl(url, 60000);
    if (!ok) throw new Error(`Vite server not reachable at ${url}`);
  } else {
    server = await startStaticServer(target, Number(new URL(url).port || 4173));
  }
}

async function stopTarget() {
  if (server) server.close();
  stopCommand(child);
}

async function collectActions(page) {
  const selectors = listInteractiveSelectors();
  const handles = [];
  for (const sel of selectors) {
    const elements = await page.$$(sel);
    for (const el of elements) handles.push({ selector: sel, handle: el });
  }
  return handles.slice(0, 12); // cap
}

async function runActions(page, depth) {
  const actions = await collectActions(page);
  const sequences = [];
  for (let i = 0; i < actions.length && sequences.length < 8; i += 1) {
    sequences.push([actions[i]]);
  }
  if (depth > 1) {
    for (let i = 0; i < actions.length && sequences.length < 12; i += 1) {
      for (let j = i + 1; j < actions.length && sequences.length < 12; j += 1) {
        sequences.push([actions[i], actions[j]]);
      }
    }
  }

  for (const seq of sequences) {
    for (const step of seq) {
      try {
        const tag = await step.handle.evaluate((el) => el.tagName.toLowerCase());
        if (tag === 'input') {
          await step.handle.fill('test');
        } else if (tag === 'textarea') {
          await step.handle.fill('test');
        } else if (tag === 'select') {
          await step.handle.selectOption({ index: 0 });
        } else {
          await step.handle.click({ timeout: 2000 });
        }
        await page.waitForTimeout(500);
      } catch (err) {
        // ignore
      }
    }
  }
}

async function capture(page, name) {
  const filePath = path.join(outDir, name);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function evaluateIteration(iteration) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await runActions(page, maxDepth);
  const screenshotPath = await capture(page, `iter_${iteration}.png`);
  const dom = await page.content();
  await browser.close();

  const img = encodeImage(screenshotPath);
  const judge = await callVisionJudge({
    prompt: masterPrompt,
    images: [img],
    metadata: { url, iteration, dom_snapshot: dom.slice(0, 4000) }
  });
  writeRunArtifact(outDir, `iter_${iteration}_judge.txt`, judge);
  return parseJudgeResponse(judge);
}

async function main() {
  await startTarget();
  let result = null;
  for (let i = 0; i < maxIterations; i += 1) {
    result = await evaluateIteration(i + 1);
    if (result.isPass) break;
  }
  await stopTarget();
  console.log(result?.raw || 'No judge output');
}

main().catch((err) => {
  console.error(err);
  stopTarget();
  process.exit(1);
});

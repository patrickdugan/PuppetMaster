#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { assertTrustedUrl, chatgptPacket, clip, config, debriefPacket, digest, receipt, redact, silicoPacket } from './core.mjs';

const flags = parseArgs(process.argv.slice(2));
const help = 'SilicoBuddy: ChatGPT ↔ Silico bounded Firefox handoff\n' +
  'npm run research:silicobuddy -- --task "research question" [--live --approve-send]\n' +
  '--task-file FILE | --task TEXT    Research question\n' +
  '--plan-file FILE                  Reuse a Codex/local experiment packet and skip ChatGPT planner\n' +
  '--live                          Start dedicated Playwright Firefox (default: dry-run)\n' +
  '--approve-send                  Explicitly permit ChatGPT and Silico message submission\n' +
  '--debrief-send                  Submit a third message back to ChatGPT\n' +
  '--silico-url URL                 Existing Silico research thread\n' +
  '--chatgpt-url URL                ChatGPT thread URL (default chatgpt.com)\n' +
  '--silico-composer SELECTOR       Verified Silico CSS composer selector\n' +
  '--silico-reply SELECTOR          Verified Silico CSS assistant reply selector\n' +
  '--max-ru N --max-gpu-hours N     Proposal ceilings; not enforced billing limits\n' +
  '--max-prompt-chars N             Per-prompt length budget (default 5000)\n' +
  '--profile-dir DIR --out-dir DIR  Dedicated auth profile and local receipts\n';
if (flags.help) { console.log(help); process.exit(0); }

const opts = config({
  maxRu: asNumber('max-ru', 0.2), maxGpuHours: asNumber('max-gpu-hours', 0),
  maxPromptChars: asInt('max-prompt-chars', 5000), maxReplyChars: asInt('max-reply-chars', 6500),
  maxRuntimeMinutes: asInt('max-minutes', 12), maxSubmissions: flags['debrief-send'] ? 3 : 2,
});
const task = String(flags.task || (flags['task-file'] ? await fs.readFile(flags['task-file'], 'utf8') : '')).trim();
if (!task) { console.error(help); process.exit(2); }
const priorPlan = flags['plan-file'] ? String(await fs.readFile(flags['plan-file'], 'utf8')).trim() : null;
if (flags['plan-file'] && !priorPlan) throw new Error('--plan-file is empty');
const runId = `silicobuddy-${digest(task).slice(0, 12)}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outRoot = path.resolve(String(flags['out-dir'] || process.env.PM_RUNS_DIR || 'runs'));
const outDir = path.join(outRoot, runId);
await fs.mkdir(outDir, { recursive: true, mode: 0o700 });
const record = { runId, taskHash: digest(task), mode: flags.live ? 'live' : 'dry-run',
  config: opts, status: 'prepared', stages: [],
  warning: 'RU/GPU cost constraints are proposal limits only. Verify actual Silico billing and approve any experiment separately.' };
const persist = async () => fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(record, null, 2));
let browserContext;
try {
  const first = priorPlan ? null : chatgptPacket(task, opts);
  if (first) {
    await writePrompt('01-chatgpt-packet.txt', first);
    record.stages.push(receipt('chatgpt_planner', first));
  }
  if (!flags.live) {
    const silico = silicoPacket(task, priorPlan || '[PASTE CHATGPT EXPERIMENT PACKET HERE]', opts);
    await writePrompt('02-silico-packet-template.txt', silico);
    record.stages.push(receipt('silico_plan_template', silico));
    record.status = 'dry_run_complete';
    await persist();
    console.log(`Dry run complete: ${outDir}\nNo browser opened, no model requests or compute launched.`);
  } else {
    if (!flags['approve-send']) throw new Error('Live mode requires --approve-send; sends messages to both chat services');
    if (!flags['silico-url'] || !flags['silico-composer'] || !flags['silico-reply'])
      throw new Error('Live mode requires --silico-url, --silico-composer and --silico-reply, verified against the current DOM');
    const chatUrl = assertTrustedUrl(String(flags['chatgpt-url'] || 'https://chatgpt.com/'), 'chatgpt');
    const silicoUrl = assertTrustedUrl(String(flags['silico-url']), 'silico');
    const { firefox } = await import('playwright');
    const profile = path.resolve(String(flags['profile-dir'] || path.join(os.homedir(), '.silicobuddy-firefox')));
    browserContext = await firefox.launchPersistentContext(profile, { headless: false, viewport: { width: 1280, height: 900 } });
    const chat = await browserContext.newPage();
    const silico = await browserContext.newPage();
    await Promise.all([chat.goto(chatUrl, { waitUntil: 'domcontentloaded' }), silico.goto(silicoUrl, { waitUntil: 'domcontentloaded' })]);
    console.log('Sign into both services in Firefox and disable Silico Auto-accept. Press Enter in this terminal to submit.');
    await pressEnter();
    await trusted(chat, 'chatgpt'); await trusted(silico, 'silico');
    const chatOutput = '[data-message-author-role="assistant"]';
    const silicoOutput = String(flags['silico-reply']);
    let sent = 0;
    let chatResult = priorPlan;
    if (!priorPlan) {
      const idx = record.stages.length - 1;
      record.stages[idx].status = 'submission_attempted'; await persist();
      chatResult = await transact(chat, 'chatgpt', '#prompt-textarea,[data-testid="prompt-textarea"],div.ProseMirror[contenteditable="true"]', chatOutput, first, opts);
      sent++; record.stages[idx] = receipt('chatgpt_planner', first, chatResult, 'submitted');
      await writePrompt('01-chatgpt-reply.txt', redact(clip(chatResult, opts.maxReplyChars)));
      await persist();
    }
    const silicoPrompt = silicoPacket(task, chatResult, opts);
    await writePrompt('02-silico-packet.txt', silicoPrompt);
    if (sent >= opts.maxSubmissions) throw new Error('Submission budget exhausted before Silico');
    const silicoIdx = record.stages.length;
    record.stages.push(receipt('silico_plan', silicoPrompt, '', 'submission_attempted')); await persist();
    const silicoResult = await transact(silico, 'silico', String(flags['silico-composer']), silicoOutput, silicoPrompt, opts);
    sent++; record.stages[silicoIdx] = receipt('silico_plan', silicoPrompt, silicoResult, 'submitted');
    await writePrompt('02-silico-reply.txt', redact(clip(silicoResult, opts.maxReplyChars)));
    const debrief = debriefPacket(task, silicoResult, opts);
    await writePrompt('03-chatgpt-debrief-template.txt', debrief);
    if (flags['debrief-send']) {
      if (sent >= opts.maxSubmissions) throw new Error('Submission budget exhausted before debrief');
      const criticIdx = record.stages.length;
      record.stages.push(receipt('chatgpt_critic', debrief, '', 'submission_attempted')); await persist();
      const feedback = await transact(chat, 'chatgpt', '#prompt-textarea,[data-testid="prompt-textarea"],div.ProseMirror[contenteditable="true"]', chatOutput, debrief, opts);
      record.stages[criticIdx] = receipt('chatgpt_critic', debrief, feedback, 'submitted');
      await writePrompt('03-chatgpt-critique.txt', redact(clip(feedback, opts.maxReplyChars)));
    } else { record.stages.push(receipt('chatgpt_critic_template', debrief)); }
    record.status = 'plan_review_required';
    await persist();
    console.log(`Silico plan captured: ${outDir}. Review plan and billing in Silico before experiment launch.`);
  }
} catch (e) {
  record.status = 'blocked'; record.error = String(e?.message || e);
  await persist();
  console.error(`SilicoBuddy stopped: ${record.error}\nArtifacts: ${outDir}`);
  process.exitCode = 1;
} finally { if (browserContext) await browserContext.close(); }

async function writePrompt(name, data) { await fs.writeFile(path.join(outDir, name), data, { mode: 0o600 }); }
async function trusted(page, svc) { assertTrustedUrl(page.url(), svc); }
async function transact(page, svc, composerSelector, replySelector, prompt, settings) {
  if (prompt.length > settings.maxPromptChars) throw new Error(`${svc} prompt budget exceeded`);
  await trusted(page, svc);
  const composer = page.locator(composerSelector);
  if (await composer.count() !== 1 || !(await composer.isVisible())) throw new Error(`${svc} composer is missing, hidden or ambiguous; refine the selector`);
  const replies = page.locator(replySelector);
  const beforeCount = await replies.count();
  const previous = beforeCount ? await replies.last().innerText({ timeout: 5000 }) : '';
  await composer.fill(prompt);
  await composer.press('Enter');
  const timeout = Math.min(settings.maxRuntimeMinutes * 60 * 1000, 360000);
  const started = Date.now(); let latest = '', settled = 0;
  while (Date.now() - started < timeout) {
    await page.waitForTimeout(1800); await trusted(page, svc);
    const count = await replies.count();
    if (!count) continue;
    const current = await replies.last().innerText({ timeout: 5000 }).catch(() => '');
    if (!current || (count === beforeCount && current === previous)) continue;
    if (current === latest) settled++; else { latest = current; settled = 0; }
    if (settled >= 3 && latest.length >= 40) return redact(clip(latest, settings.maxReplyChars));
  }
  throw new Error(`${svc} response not verified within timeout; inspect browser before retrying to avoid duplicate turns`);
}
function parseArgs(items) {
  const obj = {}; const boolean = new Set(['help', 'live', 'approve-send', 'debrief-send']);
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected positional argument: ${a}`);
    const [key, inline] = a.slice(2).split('=', 2);
    if (boolean.has(key)) { obj[key] = true; continue; }
    const val = inline ?? items[++i];
    if (val === undefined || val.startsWith('--')) throw new Error(`Missing value for --${key}`);
    obj[key] = val;
  }
  return obj;
}
function asInt(key, fallback) { const s = flags[key] ?? fallback; if (!/^\d+$/.test(String(s))) throw new Error(`--${key} must be an integer`); return Number(s); }
function asNumber(key, fallback) { const n = Number(flags[key] ?? fallback); if (!Number.isFinite(n)) throw new Error(`--${key} must be finite`); return n; }
async function pressEnter() { await new Promise(resolve => { process.stdin.resume(); process.stdin.once('data', () => { process.stdin.pause(); resolve(); }); }); }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { chromium } from 'playwright';

const API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';
const API_KEY = process.env.OPENAI_API_KEY;
const VISION_PROVIDER = (process.env.PM_VISION_PROVIDER || 'openai').toLowerCase();

export function loadMasterPrompt(promptPath) {
  return fs.readFileSync(promptPath, 'utf-8');
}

export function encodeImage(filePath) {
  const bytes = fs.readFileSync(filePath);
  return bytes.toString('base64');
}

function ensureOpenAiKey() {
  if (!API_KEY) {
    throw new Error('Missing OPENAI_API_KEY in environment');
  }
}

function writeTempPng(base64) {
  const filePath = path.join(os.tmpdir(), `pm-lens-${crypto.randomBytes(6).toString('hex')}.png`);
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

function buildLensSummary({ relatedSearchTerm, snippets }) {
  const normalized = Array.from(new Set((snippets || []).map((s) => s.trim()).filter(Boolean)));
  const cues = normalized.slice(0, 8).join(', ');
  const term = relatedSearchTerm || 'unknown subject';
  return `LENS MODE RESULT\nrelated_search_term: ${term}\ncontext_cues: ${cues || 'none'}`;
}

function buildLensJudgeContract(lensSummary) {
  const lower = String(lensSummary || '').toLowerCase();
  const failSignals = [
    '404',
    '500',
    'access denied',
    'forbidden',
    'not found',
    'page not available',
    'something went wrong',
    'error',
    'exception',
    'traceback'
  ];
  const hasFailure = failSignals.some((signal) => lower.includes(signal));
  const status = hasFailure ? 'FAIL' : 'PASS';
  const rationale = hasFailure
    ? 'Lens text suggests an error or unavailable state.'
    : 'No obvious error indicators were found in Lens text.';
  return `${status}
RATIONALE: ${rationale}
EVIDENCE:
${lensSummary}
OPTIONAL PATCH:
N/A`;
}

async function callLensVision({ images }) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('Lens provider requires at least one image');
  }
  const imagePath = writeTempPng(images[0]);
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    await page.goto('https://lens.google.com/upload', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: 'attached', timeout: 15000 });
    await input.setInputFiles(imagePath);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);

    const relatedSearchTerm = await page.evaluate(() => {
      const candidates = [
        document.querySelector('input[name="q"]'),
        document.querySelector('input[aria-label*="Search"]'),
        document.querySelector('textarea[aria-label*="Search"]')
      ];
      for (const el of candidates) {
        if (!el) continue;
        const value = (el.value || el.textContent || '').trim();
        if (value) return value;
      }
      return '';
    });

    const snippets = await page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 4 && rect.height > 4;
      };
      const nodes = Array.from(document.querySelectorAll('h1, h2, h3, a, button, span, div'));
      const out = [];
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt.length < 4 || txt.length > 120) continue;
        if (/[{};]/.test(txt)) continue;
        if (out.includes(txt)) continue;
        out.push(txt);
        if (out.length >= 40) break;
      }
      return out;
    });

    return buildLensSummary({ relatedSearchTerm, snippets });
  } finally {
    if (browser) {
      await browser.close();
    }
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  }
}

export async function callVisionJudge({ prompt, images, metadata }) {
  if (VISION_PROVIDER === 'lens') {
    const lensText = await callLensVision({ images });
    const contractMode = (process.env.PM_LENS_CONTRACT_MODE || 'judge').toLowerCase();
    if (contractMode === 'raw') {
      return `${lensText}\n\noriginal_prompt_excerpt: ${(prompt || '').slice(0, 240)}\nmetadata: ${JSON.stringify(metadata || {})}`;
    }
    return buildLensJudgeContract(lensText);
  }

  ensureOpenAiKey();
  const input = [
    {
      role: 'system',
      content: [{ type: 'input_text', text: prompt }]
    },
    {
      role: 'user',
      content: [
        { type: 'input_text', text: JSON.stringify(metadata, null, 2) },
        ...images.map((img) => ({
          type: 'input_image',
          image_url: `data:image/png;base64,${img}`
        }))
      ]
    }
  ];

  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    input,
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const parts = [];
  const outputItems = Array.isArray(json.output) ? json.output : [];
  for (const item of outputItems) {
    const contentItems = Array.isArray(item.content) ? item.content : [];
    for (const c of contentItems) {
      if (typeof c?.text === 'string') parts.push(c.text);
    }
  }
  let content = parts.join('').trim();
  if (!content && typeof json.output_text === 'string') content = json.output_text.trim();
  return content;
}

export function parseJudgeResponse(text) {
  const isPass = text.startsWith('PASS');
  const isFail = text.startsWith('FAIL');
  let patch = null;
  if (text.includes('OPTIONAL PATCH:')) {
    const parts = text.split('OPTIONAL PATCH:');
    patch = parts[1].trim();
  }
  return { isPass, isFail, patch, raw: text };
}

export function writeRunArtifact(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

export function randomId() {
  return crypto.randomBytes(4).toString('hex');
}

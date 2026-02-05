import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';
const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  throw new Error('Missing OPENAI_API_KEY in environment');
}

export function loadMasterPrompt(promptPath) {
  return fs.readFileSync(promptPath, 'utf-8');
}

export function encodeImage(filePath) {
  const bytes = fs.readFileSync(filePath);
  return bytes.toString('base64');
}

export async function callVisionJudge({ prompt, images, metadata }) {
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
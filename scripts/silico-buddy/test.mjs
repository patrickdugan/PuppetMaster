import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertTrustedUrl, chatgptPacket, clip, config, debriefPacket, digest, receipt, redact, silicoPacket } from './core.mjs';

test('dry-run packets are bounded and deterministic', () => {
  const task = 'Can Qwen 0.8B pass SWMD-MIN?';
  const a = chatgptPacket(task, {});
  assert.equal(a, chatgptPacket(task, {}));
  assert.match(a, /falsifiable/);
  assert.match(silicoPacket(task, 'Use baseline', {}), /PLAN ONLY/);
  assert.match(silicoPacket(task, 'Use baseline', {}), /0 GPU-hours/);
  assert.match(debriefPacket(task, 'Silico plan', {}), /independent reviewer/);
});
test('blocks wrong or insecure service origins', () => {
  assert.throws(() => assertTrustedUrl('https://chatgpt.com.evil.com/', 'chatgpt'));
  assert.throws(() => assertTrustedUrl('http://silico.ai/', 'silico'));
  assert.match(assertTrustedUrl('https://app.silico.ai/t/123', 'silico'), /app.silico.ai/);
  assert.match(assertTrustedUrl('https://chatgpt.com/c/123', 'chatgpt'), /chatgpt.com/);
});
test('rejects unsafe budgeting', () => {
  assert.throws(() => config({maxRu:-1}));
  assert.throws(() => config({maxGpuHours:NaN}));
  assert.throws(() => config({maxSubmissions:4}));
  assert.throws(() => config({maxPromptChars:20}));
});
test('long results retain head and tail', () => {
  const result = clip('H'.repeat(8000) + 'TRAILER', 1200);
  assert.ok(result.length <= 1200);
  assert.match(result, /TRAILER$/);
  assert.match(result, /OMITTED/);
});
test('sensitive token strings are redacted', () => {
  const secret = 'sk-abcde12345abcde12345abcde';
  assert.ok(!redact(secret).includes(secret));
  assert.ok(!silicoPacket('test', secret, {}).includes(secret));
});
test('receipts report estimates, not invented costs', () => {
  const r = receipt('chatgpt', 'abcd', 'ok');
  assert.equal(r.estimatedPromptTokens, 1);
  assert.equal(r.measuredBilling, null);
  assert.equal(r.promptHash, digest('abcd'));
});
test('short budget blocks oversized packet', () => {
  assert.throws(() => chatgptPacket('a'.repeat(9900), {maxPromptChars:500}));
});

test('optional plan-file mode is documented as one Silico submission', () => {
  const template = silicoPacket('hypothesis', 'Codex local packet', {});
  assert.match(template, /Codex local packet/);
  assert.ok(template.length <= config().maxPromptChars);
});

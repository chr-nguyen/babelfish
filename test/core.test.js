import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCaption, SpeechGate, orderedItems } from '../public/core.js';
import { translationRequest, validateInput, parseTranslation } from '../lib/translation.js';
test('cleaning removes fillers but preserves meaningful Japanese responses', () => {
  assert.equal(cleanCaption('Um, I think, uh, we should go.'), 'I think, we should go.');
  assert.equal(cleanCaption('えー、明日です。'), '明日です。');
  for (const text of ['はい', 'うん', 'ええ', 'あの店です。', 'うーん、難しいですね。']) assert.equal(cleanCaption(text), text);
  assert.equal(cleanCaption('Um, yes.', false), 'Um, yes.');
});
test('silence sends no audio and speech keeps pre-roll then commits once', () => {
  const gate = new SpeechGate();
  for (let i = 0; i < 50; i++) assert.deepEqual(gate.push(i, .001), { frames: [], commit: false });
  assert.deepEqual(gate.push(50, .1), { frames: [48,49,50], commit: false });
  for (let i = 0; i < 5; i++) assert.equal(gate.push(i, .001).commit, false);
  assert.equal(gate.push(6, .001).commit, true);
  assert.equal(gate.finish(), false);
});
test('long speech is bounded and stop flushes an active turn', () => {
  const gate = new SpeechGate(); let commits = 0;
  for (let i = 0; i < 160; i++) commits += Number(gate.push(i, .1).commit);
  assert.equal(commits, 2);
  gate.push(1, .1); assert.equal(gate.finish(), true); assert.equal(gate.finish(), false);
});
test('out-of-order completions are reconciled using predecessor IDs', () => {
  const b = { id: 'b', previous: 'a' }, a = { id: 'a' }, c = { id: 'c', previous: 'b' };
  assert.deepEqual(orderedItems([c,b,a]).map(i => i.id), ['a','b','c']);
});
test('translation input limits and structured responses are enforced', () => {
  const input = { text: 'Hello', context: ['こんにちは'], clean: true };
  assert.equal(validateInput(input), true);
  assert.equal(validateInput({ ...input, text: 'x'.repeat(3001) }), false);
  assert.equal(validateInput({ ...input, context: [{}] }), false);
  const request = translationRequest(input, 'test-model');
  assert.equal(request.store, false); assert.equal(request.text.format.strict, true);
  assert.deepEqual(JSON.parse(request.input), { CONTEXT: ['こんにちは'], CURRENT: 'Hello' });
  assert.throws(() => parseTranslation({ output: [] }));
  const result = { en: 'Hello', ja: 'こんにちは', source: 'en' };
  assert.deepEqual(parseTranslation({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }), result);
});

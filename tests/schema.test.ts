import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionSchema, SuiteSchema } from '../src/schema.js';

test('accepts a valid click action', () => {
  const parsed = ActionSchema.parse({ action: 'click', ref: 3, reason: 'Submit the form' });
  assert.equal(parsed.action, 'click');
});

test('rejects unknown actions and extra executable fields', () => {
  assert.equal(ActionSchema.safeParse({ action: 'evaluate', code: 'alert(1)', reason: 'bad' }).success, false);
  assert.equal(ActionSchema.safeParse({ action: 'click', ref: 1, reason: 'click', javascript: '...' }).success, false);
});

test('rejects non-positive element references', () => {
  assert.equal(ActionSchema.safeParse({ action: 'click', ref: 0, reason: 'invalid' }).success, false);
});

test('validates suite cases and expected verdicts', () => {
  assert.equal(SuiteSchema.safeParse([{ name: 'home', url: 'https://example.com', test: 'Verify home', expect: 'PASS' }]).success, true);
  assert.equal(SuiteSchema.safeParse([{ name: 'home', url: 'https://example.com', test: 'Verify home', expect: 'MAYBE' }]).success, false);
});

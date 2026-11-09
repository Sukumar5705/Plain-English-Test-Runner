import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, resolveTemplate } from '../src/executor.js';

test('redacts supplied data values from text', () => {
  assert.equal(redact('password=hunter2; email=a@example.com', { password: 'hunter2' }), 'password=[REDACTED]; email=a@example.com');
});

test('substitutes a local data placeholder', () => {
  assert.equal(resolveTemplate('Hello {{email}}', { email: 'qa@example.com' }), 'Hello qa@example.com');
});

test('throws on an unknown placeholder', () => {
  assert.throws(() => resolveTemplate('{{missing}}', {}), /Unknown test-data placeholder/);
});

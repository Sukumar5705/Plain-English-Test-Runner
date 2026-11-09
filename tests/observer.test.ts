import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { observe } from '../src/observer.js';

test('observes visible controls without exposing entered input values', async () => {
  const fixture = await readFile(new URL('./fixtures/login.html', import.meta.url), 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(fixture);
    await page.getByLabel('Email address').fill('private@example.com');
    await page.getByLabel('Password').fill('super-secret');
    const observation = await observe(page);
    assert.equal(observation.title, 'Local Test Login');
    assert.ok(observation.elements.some((element) => element.name === 'Email address'));
    assert.ok(observation.elements.some((element) => element.name === 'Password'));
    assert.ok(observation.elements.some((element) => element.role === 'checkbox'));
    assert.ok(observation.elements.some((element) => element.role === 'button' && element.name === 'Sign in'));
    assert.ok(!JSON.stringify(observation).includes('private@example.com'));
    assert.ok(!JSON.stringify(observation).includes('super-secret'));
  } finally {
    await browser.close();
  }
});

import { expect, type Page } from '@playwright/test';
import type { Action, ElementInfo, Observation, Target } from './schema.js';

const ACTION_TIMEOUT = 8_000;
const ASSERT_VISIBLE_TIMEOUT = 7_000;
const ASSERT_HIDDEN_TIMEOUT = 4_000;
const ASSERT_URL_TIMEOUT = 7_000;

export type ExecutionResult = { target?: Target; expected?: string };

export function resolveTemplate(value: string, data: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_match, key: string) => {
    const normalized = key.toLowerCase();
    if (!(normalized in data)) throw new Error(`Unknown test-data placeholder: {{${key}}}`);
    return data[normalized]!;
  });
}

export function redact(value: string, secrets: Record<string, string>): string {
  let output = value;
  const values = Object.entries(secrets)
    .filter(([key, secret]) => secret.length > 0 && /pass|secret|token|key|email|user/i.test(key))
    .map(([, secret]) => secret)
    .sort((a, b) => b.length - a.length);
  for (const secret of values) output = output.split(secret).join('[REDACTED]');
  return output;
}

function getTarget(observation: Observation, ref: number): Target | undefined {
  const element = observation.elements.find((item) => item.ref === ref);
  if (!element) return undefined;
  const peers = observation.elements.filter((item) => item.role === element.role && item.name === element.name);
  const nth = peers.findIndex((item) => item.ref === ref);
  return {
    role: element.role,
    name: element.name,
    ...(nth > 0 ? { nth } : {}),
    ...(element.type ? { type: element.type } : {}),
    ...(element.placeholder ? { placeholder: element.placeholder } : {})
  };
}

function expectedFor(action: Action): string | undefined {
  switch (action.action) {
    case 'assertVisible': return `Text "${action.text}" is visible`;
    case 'assertNotVisible': return `Text "${action.text}" is not visible`;
    case 'assertUrl': return `URL contains "${action.contains}"`;
    default: return undefined;
  }
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
}

export async function executeAction(
  page: Page,
  action: Action,
  observation: Observation,
  data: Record<string, string>,
  startUrl: string,
  allowedOrigins: string[]
): Promise<ExecutionResult> {
  let target: Target | undefined;
  if ('ref' in action) {
    target = getTarget(observation, action.ref);
    if (!target) throw new Error(`Ref ${action.ref} was not present in the current observation.`);
  }

  switch (action.action) {
    case 'navigate': {
      const destination = new URL(action.url);
      const startOrigin = new URL(startUrl).origin;
      if (destination.origin !== startOrigin && !allowedOrigins.includes(destination.origin)) {
        throw new Error(`Navigation blocked by origin policy: ${destination.origin}`);
      }
      await page.goto(destination.toString(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
      break;
    }
    case 'click':
      await page.locator(`[data-tr-ref="${action.ref}"]`).click({ timeout: ACTION_TIMEOUT });
      break;
    case 'fill':
      await page.locator(`[data-tr-ref="${action.ref}"]`).fill(resolveTemplate(action.value, data), { timeout: ACTION_TIMEOUT });
      break;
    case 'select':
      await page.locator(`[data-tr-ref="${action.ref}"]`).selectOption({ label: action.option }, { timeout: ACTION_TIMEOUT });
      break;
    case 'check': {
      const locator = page.locator(`[data-tr-ref="${action.ref}"]`);
      const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());
      if (tagName === 'input') await locator.check({ timeout: ACTION_TIMEOUT });
      else await locator.click({ timeout: ACTION_TIMEOUT });
      break;
    }
    case 'press':
      await page.keyboard.press(action.key);
      break;
    case 'assertVisible':
      await expect(page.getByText(action.text, { exact: false }).filter({ visible: true }).first()).toBeVisible({ timeout: ASSERT_VISIBLE_TIMEOUT });
      break;
    case 'assertNotVisible':
      await expect(page.getByText(action.text, { exact: false }).filter({ visible: true })).toHaveCount(0, { timeout: ASSERT_HIDDEN_TIMEOUT });
      break;
    case 'assertUrl':
      await expect(page).toHaveURL((url) => url.href.includes(action.contains), { timeout: ASSERT_URL_TIMEOUT });
      break;
    case 'finish':
      break;
  }

  if (action.action !== 'finish' && action.action !== 'assertVisible' && action.action !== 'assertNotVisible' && action.action !== 'assertUrl') {
    await settle(page);
  }
  const expected = expectedFor(action);
  return { ...(target ? { target } : {}), ...(expected ? { expected } : {}) };
}

export function assertionDescription(action: Action): string | undefined {
  return expectedFor(action);
}

export function elementForRef(observation: Observation, ref: number): ElementInfo | undefined {
  return observation.elements.find((element) => element.ref === ref);
}

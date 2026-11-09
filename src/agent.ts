import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nextAction } from './llm.js';
import { observe } from './observer.js';
import { assertionDescription, elementForRef, executeAction } from './executor.js';
import { artifactSummary, logStep, writeArtifacts } from './report.js';
import { isAssertion, type Action, type AssertionRecord, type ElementInfo, type RunConfig, type RunResult, type StepRecord, type Verdict } from './schema.js';

export type VerdictState = {
  passedAssertions: number;
  failedAssertions: number;
  finishStatus: 'done' | 'blocked' | null;
  fatalProblem: string | null;
};

export function computeVerdict(state: VerdictState): { verdict: Verdict; reason: string } {
  if (state.failedAssertions > 0) return { verdict: 'FAIL', reason: 'At least one Playwright assertion failed.' };
  if (state.fatalProblem) return { verdict: 'ERROR', reason: state.fatalProblem };
  if (state.finishStatus === 'blocked') return { verdict: 'ERROR', reason: 'The AI agent reported that the task is blocked.' };
  if (state.finishStatus !== 'done') return { verdict: 'ERROR', reason: 'The agent did not finish the test within the execution limit.' };
  if (state.passedAssertions === 0) return { verdict: 'ERROR', reason: 'The run finished without executing a successful assertion.' };
  return { verdict: 'PASS', reason: 'All executed assertions passed and the agent completed the requested test.' };
}

function targetFromObservation(observation: Awaited<ReturnType<typeof observe>>, element: ElementInfo | undefined) {
  if (!element) return undefined;
  const peers = observation.elements.filter((candidate) => candidate.role === element.role && candidate.name === element.name);
  const nth = peers.findIndex((candidate) => candidate.ref === element.ref);
  return {
    role: element.role,
    name: element.name,
    ...(nth > 0 ? { nth } : {}),
    ...(element.type ? { type: element.type } : {}),
    ...(element.placeholder ? { placeholder: element.placeholder } : {})
  };
}

function screenshotName(step: number): string {
  return `screenshots/step-${String(step).padStart(2, '0')}.png`;
}

async function saveScreenshot(page: Page | null, runDir: string, name: string): Promise<string> {
  if (!page || page.isClosed()) return '';
  try {
    const fullPath = join(runDir, name);
    await mkdir(join(runDir, 'screenshots'), { recursive: true });
    await page.screenshot({ path: fullPath, fullPage: true, animations: 'disabled', timeout: 5_000 });
    return name;
  } catch {
    return '';
  }
}

function assertionExpected(action: Action): string {
  return assertionDescription(action) ?? action.action;
}

function compactActionSignature(action: Action, url: string): string {
  const copy = { ...action } as Record<string, unknown>;
  delete copy.reason;
  return `${JSON.stringify(copy)}|${url}`;
}

function safeConfig(config: RunConfig): Record<string, unknown> {
  return {
    model: config.llm.model,
    baseURL: config.llm.baseURL,
    headed: config.headed,
    maxSteps: config.maxSteps,
    allowedOrigins: config.allowedOrigins
  };
}

export async function runTest(config: RunConfig): Promise<RunResult> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const runDir = join(config.outDir, `run-${startedAt.replace(/[:.]/g, '-')}`);
  await mkdir(join(runDir, 'screenshots'), { recursive: true });
  const steps: StepRecord[] = [];
  const assertionDetails: AssertionRecord[] = [];
  const state: VerdictState = { passedAssertions: 0, failedAssertions: 0, finishStatus: null, fatalProblem: null };
  const actionSignatures: string[] = [];
  const dialogMessages: string[] = [];
  const redactionData: Record<string, string> = { ...config.data };
  let initialText = '';
  let stateChanged = false;
  let failure: RunResult['failure'];
  let lastObservationText = '';
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let activePage: Page | null = null;
  try {
    browser = await chromium.launch({ headless: !config.headed });
    context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    activePage = await context.newPage();
    const attachDialogHandler = (page: Page): void => {
      page.on('dialog', (dialog) => {
        dialogMessages.push(dialog.message());
        void dialog.accept().catch(() => undefined);
      });
    };
    attachDialogHandler(activePage);
    context.on('page', (newPage) => {
      activePage = newPage;
      attachDialogHandler(newPage);
    });
    try {
      await activePage.goto(config.url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    } catch (error) {
      state.fatalProblem = `Site unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (!state.fatalProblem && activePage) {
      await saveScreenshot(activePage, runDir, 'screenshots/initial.png');
      let lastError: string | null = null;
      let consecutiveErrors = 0;

      for (let stepNumber = 1; stepNumber <= config.maxSteps; stepNumber += 1) {
        let observation;
        try {
          observation = await observe(activePage);
          if (dialogMessages.length) observation.alerts = [...dialogMessages.splice(0), ...observation.alerts].slice(0, 12);
        } catch (error) {
          state.fatalProblem = `Could not inspect the current page: ${error instanceof Error ? error.message : String(error)}`;
          break;
        }
        if (stepNumber === 1) initialText = observation.text.toLowerCase();
        lastObservationText = observation.text;
        let action: Action;
        try {
          action = await nextAction({
            goal: config.test,
            startUrl: config.url,
            dataKeys: Object.keys(config.data),
            step: stepNumber,
            maxSteps: config.maxSteps,
            history: steps,
            observation,
            lastError
          }, config.llm);
        } catch (error) {
          state.fatalProblem = error instanceof Error ? error.message : String(error);
          break;
        }
        if (action.action === 'finish') {
          state.finishStatus = action.status;
          if (action.status === 'blocked') state.fatalProblem = action.reason;
          break;
        }
        const urlBefore = activePage.url();
        const signature = compactActionSignature(action, urlBefore);
        actionSignatures.push(signature);
        if (actionSignatures.length >= 3 && actionSignatures.slice(-3).every((entry) => entry === signature)) {
          state.fatalProblem = 'Stuck loop detected: the same action was proposed three times on the same URL.';
          break;
        }
        const startedStep = Date.now();
        let status: StepRecord['status'] = 'ok';
        let errorMessage: string | undefined;
        let target = 'ref' in action ? targetFromObservation(observation, elementForRef(observation, action.ref)) : undefined;
        let expected: string | undefined;
        if (action.action === 'fill' && target && /pass|secret|token|key|email|user/i.test(target.name) && !/^\{\{[a-zA-Z0-9_-]+\}\}$/.test(action.value)) {
          redactionData[`inline-secret-${stepNumber}`] = action.value;
        }
        try {
          const execution = await executeAction(activePage, action, observation, config.data, config.url, config.allowedOrigins);
          target = execution.target ?? target;
          expected = execution.expected;
          consecutiveErrors = 0;
          lastError = null;
          if (action.action === 'click' || action.action === 'fill' || action.action === 'select' || action.action === 'check' || action.action === 'press' || (action.action === 'navigate' && stepNumber > 1)) {
            stateChanged = true;
          }
          if (isAssertion(action)) {
            state.passedAssertions += 1;
            assertionDetails.push({ action: action.action, expected: expected ?? assertionExpected(action), reason: action.reason, status: 'passed' });
          }
        } catch (error) {
          status = 'failed';
          errorMessage = error instanceof Error ? error.message : String(error);
          lastError = errorMessage;
          consecutiveErrors += 1;
          if (isAssertion(action)) {
            state.failedAssertions += 1;
            assertionDetails.push({ action: action.action, expected: assertionExpected(action), reason: action.reason, status: 'failed' });
          }
        }
        const shot = await saveScreenshot(activePage, runDir, screenshotName(stepNumber));
        const step: StepRecord = {
          n: stepNumber,
          action,
          ...(target ? { target } : {}),
          status,
          ...(errorMessage ? { error: errorMessage } : {}),
          urlBefore,
          urlAfter: activePage && !activePage.isClosed() ? activePage.url() : urlBefore,
          screenshot: shot,
          ms: Date.now() - startedStep,
          observation
        };
        steps.push(step);
        logStep(step, redactionData);
        if (status === 'failed' && isAssertion(action)) {
          let actualText = lastObservationText;
          try { actualText = (await activePage.locator('body').innerText({ timeout: 1_500 })).slice(0, 2_000); } catch { /* Keep last observation. */ }
          failure = {
            expected: assertionExpected(action),
            actualUrl: activePage.url(),
            textExcerpt: actualText,
            screenshot: shot
          };
          break;
        }
        if (consecutiveErrors >= 3) {
          state.fatalProblem = 'Three consecutive browser actions failed. The run is inconclusive.';
          break;
        }
      }
      if (!state.finishStatus && !state.fatalProblem && steps.length >= config.maxSteps) {
        state.fatalProblem = `Step limit reached (${config.maxSteps}) before the agent finished.`;
      }
    }
  } catch (error) {
    state.fatalProblem = `Unexpected runner error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
  const verdictResult = computeVerdict(state);
  const weakEvidence = verdictResult.verdict === 'PASS' && stateChanged && assertionDetails.some((item) => {
    if (item.action !== 'assertVisible' || item.status !== 'passed') return false;
    const match = item.expected.match(/^Text \"([\s\S]*)\" is visible$/);
    return Boolean(match?.[1] && initialText.includes(match[1].toLowerCase()));
  });
  const result: RunResult = {
    verdict: verdictResult.verdict,
    reason: verdictResult.reason,
    weakEvidence,
    assertions: { passed: state.passedAssertions, failed: state.failedAssertions },
    assertionDetails,
    steps,
    ...(failure ? { failure } : {}),
    goal: Object.values(redactionData).reduce((goal, secret) => secret ? goal.split(secret).join('[REDACTED]') : goal, config.test),
    startUrl: config.url,
    startedAt,
    durationMs: Date.now() - started,
    config: safeConfig(config)
  };
  const paths = await writeArtifacts(result, config.outDir, redactionData);
  console.log(`\nRESULT: ${result.verdict} — ${result.reason}`);
  console.log(artifactSummary(paths));
  return result;
}

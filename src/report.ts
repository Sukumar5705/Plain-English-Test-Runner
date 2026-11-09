import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Action, RunResult, StepRecord, SuiteCase, Verdict } from './schema.js';
import { redact } from './executor.js';

export type ArtifactPaths = { runDir: string; tracePath: string; reportPath: string; exportPath?: string };

function escapeHtml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

function safeJson(value: unknown, secrets: Record<string, string>): unknown {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map((item) => safeJson(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeJson(item, secrets)]));
  }
  return value;
}

function actionLabel(action: Action): string {
  if ('ref' in action) return `${action.action} [${action.ref}]`;
  if ('text' in action) return `${action.action} "${action.text}"`;
  if ('contains' in action) return `${action.action} "${action.contains}"`;
  if ('url' in action) return `${action.action} ${action.url}`;
  if ('key' in action) return `${action.action} ${action.key}`;
  if ('status' in action) return `${action.action} ${action.status}`;
  return action;
}

export function logStep(step: StepRecord, secrets: Record<string, string>): void {
  const targetName = step.target?.name ? ` '${step.target.name}'` : '';
  const line = `step ${String(step.n).padStart(2, '0')}  ${actionLabel(step.action)}${targetName}  ${step.status.toUpperCase()}  ${step.ms}ms  ${step.action.reason}`;
  console.log(redact(line, secrets));
}

function locatorExpression(target: { role: string; name: string; nth?: number; type?: string; placeholder?: string } | undefined): string | null {
  if (!target || !target.name) return null;
  let expression: string;
  if (target.type === 'password') {
    expression = target.placeholder
      ? `page.getByPlaceholder(${JSON.stringify(target.placeholder)}, { exact: true })`
      : `page.locator('input[type=\"password\"]')`;
  } else if (target.role === 'generic') expression = `page.getByText(${JSON.stringify(target.name)}, { exact: true })`;
  else expression = `page.getByRole(${JSON.stringify(target.role)}, { name: ${JSON.stringify(target.name)}, exact: true })`;
  if (target.nth !== undefined) expression += `.nth(${target.nth})`;
  return expression;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function renderSpec(result: RunResult): string {
  const lines = [
    '// Generated from a successful Plain-English Test Runner execution.',
    '// This is a starting point: review selectors and test data before using in CI.',
    `import 'dotenv/config';`,
    `import { test, expect } from '@playwright/test';`,
    '',
    `test(${JSON.stringify(result.goal)}, async ({ page }) => {`,
    `  await page.goto(${JSON.stringify(result.startUrl)});`
  ];

  for (const step of result.steps) {
    const action = step.action;
    if (step.status !== 'ok' || action.action === 'finish' || action.action === 'navigate') {
      if (action.action === 'navigate' && step.status === 'ok') lines.push(`  await page.goto(${JSON.stringify(action.url)});`);
      continue;
    }
    const locator = locatorExpression(step.target);
    switch (action.action) {
      case 'click':
        lines.push(locator ? `  await ${locator}.click();` : `  // TODO: Resolve unnamed click target ref ${action.ref}.`);
        break;
      case 'fill': {
        if (!locator) {
          lines.push(`  // TODO: Resolve unnamed fill target ref ${action.ref}.`);
          break;
        }
        const placeholder = action.value.match(/^\{\{([a-zA-Z0-9_-]+)\}\}$/);
        const sensitiveTarget = /pass|secret|token|key|email|user/i.test(step.target?.name ?? '');
        if (placeholder) {
          lines.push(`  await ${locator}.fill(process.env.DATA_${placeholder[1]!.toUpperCase()}!);`);
        } else if (sensitiveTarget) {
          lines.push(`  // TODO: Supply this sensitive value through DATA_<KEY>; it was not exported.`);
        } else {
          lines.push(`  await ${locator}.fill(${JSON.stringify(action.value)});`);
        }
        break;
      }
      case 'select':
        lines.push(locator ? `  await ${locator}.selectOption({ label: ${JSON.stringify(action.option)} });` : `  // TODO: Resolve unnamed select target ref ${action.ref}.`);
        break;
      case 'check':
        lines.push(locator ? `  await ${locator}.check();` : `  // TODO: Resolve unnamed checkbox target ref ${action.ref}.`);
        break;
      case 'press':
        lines.push(`  await page.keyboard.press(${JSON.stringify(action.key)});`);
        break;
      case 'assertVisible':
        lines.push(`  await expect(page.getByText(${JSON.stringify(action.text)}).filter({ visible: true }).first()).toBeVisible();`);
        break;
      case 'assertNotVisible':
        lines.push(`  await expect(page.getByText(${JSON.stringify(action.text)}).filter({ visible: true })).toHaveCount(0);`);
        break;
      case 'assertUrl':
        lines.push(`  await expect(page).toHaveURL(new RegExp(${JSON.stringify(escapeRegExp(action.contains))}));`);
        break;
    }
  }
  lines.push('});', '');
  return lines.join('\n');
}

function verdictClass(verdict: Verdict): string {
  return verdict.toLowerCase();
}

async function renderHtml(result: RunResult, runDir: string, secrets: Record<string, string>): Promise<string> {
  const screenshotData = new Map<string, string>();
  const screenshotNames = new Set(result.steps.map((step) => step.screenshot).filter(Boolean));
  if (result.failure?.screenshot) screenshotNames.add(result.failure.screenshot);
  for (const name of screenshotNames) {
    if (!name) continue;
    try {
      const data = await readFile(join(runDir, name));
      screenshotData.set(name, `data:image/png;base64,${data.toString('base64')}`);
    } catch { /* A missing screenshot is shown as unavailable. */ }
  }

  const rows = result.steps.map((step) => {
    const screenshot = screenshotData.get(step.screenshot);
    const action = escapeHtml(redact(actionLabel(step.action), secrets));
    const reason = escapeHtml(redact(step.action.reason, secrets));
    const target = step.target ? escapeHtml(redact(`${step.target.role}: ${step.target.name}`, secrets)) : '—';
    const error = step.error ? `<div class="error">${escapeHtml(redact(step.error, secrets))}</div>` : '';
    const image = screenshot ? `<a href="${screenshot}" target="_blank" rel="noreferrer"><img class="shot" src="${screenshot}" alt="Step ${step.n} screenshot"></a>` : '<span class="muted">Unavailable</span>';
    const observed = step.observation ? `<details><summary>Page snapshot</summary><pre>${escapeHtml(redact(JSON.stringify(step.observation, null, 2), secrets))}</pre></details>` : '';
    return `<tr><td>${step.n}</td><td><code>${action}</code>${error}${observed}</td><td>${target}</td><td>${reason}</td><td><span class="pill ${step.status}">${step.status}</span></td><td>${step.ms} ms</td><td>${image}</td></tr>`;
  }).join('\n');

  const failureImage = result.failure ? screenshotData.get(result.failure.screenshot) : undefined;
  const failurePanel = result.failure ? `<section class="panel"><h2>Failure evidence</h2><p><strong>Expected:</strong> ${escapeHtml(redact(result.failure.expected, secrets))}</p><p><strong>Actual URL:</strong> ${escapeHtml(redact(result.failure.actualUrl, secrets))}</p><pre>${escapeHtml(redact(result.failure.textExcerpt, secrets))}</pre>${failureImage ? `<img class="failure-shot" src="${failureImage}" alt="Failure screenshot">` : ''}</section>` : '';
  const weakPanel = result.weakEvidence ? '<section class="notice"><strong>Weak evidence:</strong> an asserted visible-text phrase was already present in the initial page observation after a state-changing action. Review the assertion before trusting this PASS.</section>' : '';
  const assertions = result.assertionDetails.map((item) => `<li><span class="pill ${item.status === 'passed' ? 'ok' : 'failed'}">${item.status}</span> ${escapeHtml(redact(item.expected, secrets))} <small>— ${escapeHtml(redact(item.reason, secrets))}</small></li>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Test report — ${result.verdict}</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb}body{margin:0;padding:32px}.wrap{max-width:1180px;margin:auto}.hero,.panel{background:#fff;border:1px solid #e5e9f2;border-radius:16px;padding:24px;margin-bottom:18px;box-shadow:0 4px 18px #17203308}.hero{display:flex;justify-content:space-between;gap:24px;align-items:center}.verdict{font-size:28px;font-weight:800;letter-spacing:.04em}.verdict.pass{color:#15803d}.verdict.fail{color:#b91c1c}.verdict.error{color:#b45309}.muted,small{color:#667085}.meta{display:flex;flex-wrap:wrap;gap:18px;margin-top:12px;font-size:13px;color:#667085}.panel h2{margin-top:0;font-size:18px}.notice{background:#fff7e6;border:1px solid #f6d58a;border-radius:12px;padding:16px;margin-bottom:18px}.pill{display:inline-block;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:700;text-transform:uppercase}.pill.ok{background:#dcfce7;color:#166534}.pill.failed{background:#fee2e2;color:#991b1b}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #edf0f5}th{background:#f8fafc;white-space:nowrap}.shot{width:130px;max-height:90px;object-fit:cover;border:1px solid #e5e9f2;border-radius:7px}.failure-shot{max-width:100%;border:1px solid #e5e9f2;border-radius:10px}pre{background:#f8fafc;padding:12px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}.error{color:#b91c1c;margin-top:7px;max-width:360px}code{overflow-wrap:anywhere}.stats{display:flex;gap:22px;flex-wrap:wrap}.stats strong{display:block;font-size:21px}.assertions{padding-left:20px}.assertions li{margin:9px 0}.goal{font-size:16px;line-height:1.55}
</style></head><body><main class="wrap">
<header class="hero"><div><div class="verdict ${verdictClass(result.verdict)}">${result.verdict}</div><h1>Plain-English Test Run</h1><p>${escapeHtml(redact(result.reason, secrets))}</p><div class="meta"><span>URL: ${escapeHtml(redact(result.startUrl, secrets))}</span><span>Started: ${escapeHtml(result.startedAt)}</span><span>Duration: ${(result.durationMs / 1000).toFixed(1)} s</span><span>Model: ${escapeHtml(String(result.config.model ?? 'unknown'))}</span></div></div><div class="stats"><div><strong>${result.steps.length}</strong><small>Steps</small></div><div><strong>${result.assertions.passed}</strong><small>Assertions passed</small></div><div><strong>${result.assertions.failed}</strong><small>Assertions failed</small></div></div></header>
<section class="panel"><h2>Test case</h2><p class="goal">${escapeHtml(redact(result.goal, secrets))}</p></section>
${weakPanel}${failurePanel}
<section class="panel"><h2>Assertions</h2><ul class="assertions">${assertions || '<li class="muted">No assertions were executed.</li>'}</ul></section>
<section class="panel"><h2>Execution steps</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>Action</th><th>Target</th><th>Reason</th><th>Result</th><th>Time</th><th>Screenshot</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No browser actions were executed.</td></tr>'}</tbody></table></div></section>
<footer class="muted">The verdict is computed by the runner from Playwright assertions. The AI proposes actions but does not grade the test.</footer>
</main></body></html>`;
}

export async function writeArtifacts(result: RunResult, outDir: string, secrets: Record<string, string>): Promise<ArtifactPaths> {
  const safeTimestamp = result.startedAt.replace(/[:.]/g, '-');
  const runDir = join(outDir, `run-${safeTimestamp}`);
  await mkdir(runDir, { recursive: true });
  const tracePath = join(runDir, 'trace.json');
  const reportPath = join(runDir, 'report.html');
  await writeFile(tracePath, JSON.stringify(safeJson(result, secrets), null, 2), 'utf8');
  await writeFile(reportPath, await renderHtml(result, runDir, secrets), 'utf8');
  if (result.verdict === 'PASS') {
    const exportPath = join(runDir, 'generated.spec.ts');
    await writeFile(exportPath, renderSpec(result), 'utf8');
    return { runDir, tracePath, reportPath, exportPath };
  }
  return { runDir, tracePath, reportPath };
}

export function printSuite(results: Array<{ test: SuiteCase; verdict: Verdict; durationMs: number }>): boolean {
  console.log('\nNAME'.padEnd(30) + 'EXPECTED'.padEnd(11) + 'ACTUAL'.padEnd(10) + 'MATCH'.padEnd(8) + 'TIME');
  let matched = 0;
  for (const item of results) {
    const ok = item.test.expect === item.verdict;
    if (ok) matched += 1;
    console.log(item.test.name.slice(0, 28).padEnd(30) + item.test.expect.padEnd(11) + item.verdict.padEnd(10) + (ok ? 'yes' : 'no').padEnd(8) + `${(item.durationMs / 1000).toFixed(1)}s`);
  }
  console.log(`${matched}/${results.length} cases matched expected verdicts.`);
  return matched === results.length;
}

export function artifactSummary(paths: ArtifactPaths): string {
  return `Report: ${paths.reportPath}\nTrace: ${paths.tracePath}${paths.exportPath ? `\nReusable test: ${paths.exportPath}` : ''}`;
}

export function shortArtifactName(paths: ArtifactPaths): string {
  return basename(paths.runDir);
}

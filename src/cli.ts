
import 'dotenv/config';

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runTest } from './agent.js';
import { printSuite } from './report.js';

import {
  SuiteSchema,
  type LlmConfig,
  type RunConfig,
  type SuiteCase
} from './schema.js';

const HELP = `Plain-English Test Runner

Single test:
  npm start -- --url <url> --test "<plain-English test>" [options]

Suite:
  npm run suite -- [examples/suite.json] [--headed]

Options:
  --url <url>                 Starting website URL
  --test <text>               Plain-English test instruction
  --data <key=value>          Test data; repeatable
  --headed                    Show Chromium while the test runs
  --max-steps <number>        Maximum AI decisions (default: 25)
  --out <directory>           Artifact output directory
  --allow-origin <origin>     Additional allowed navigation origin
  --suite                     Run a JSON test suite
  --help                      Show this help

Environment:
  OPENROUTER_API_KEY
  LLM_MODEL
  LLM_BASE_URL
  LLM_TEMPERATURE
  LLM_JSON_MODE
  DATA_EMAIL
  DATA_PASSWORD
`;

function parseCli() {
  return parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      url: { type: 'string' },
      test: { type: 'string' },
      data: { type: 'string', multiple: true },
      headed: { type: 'boolean', default: false },
      'max-steps': { type: 'string', default: '25' },
      out: { type: 'string', default: 'artifacts' },
      'allow-origin': { type: 'string', multiple: true },
      suite: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false }
    }
  });
}

function loadData(
  cliEntries: string[] = []
): Record<string, string> {
  const data: Record<string, string> = {};

  // Read DATA_* values from .env.
  for (const [key, value] of Object.entries(process.env)) {
    if (
      key.startsWith('DATA_') &&
      value !== undefined &&
      value !== ''
    ) {
      data[key.slice(5).toLowerCase()] = value;
    }
  }

  // CLI values override environment values.
  for (const entry of cliEntries) {
    const separator = entry.indexOf('=');

    if (separator <= 0) {
      throw new Error(
        `Invalid --data value "${entry}". Use --data key=value.`
      );
    }

    const key = entry.slice(0, separator).toLowerCase();
    const value = entry.slice(separator + 1);

    data[key] = value;
  }

  return data;
}

function loadLlmConfig(): LlmConfig {
  const apiKey =
    process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is missing. Add your OpenRouter API key to .env.'
    );
  }

  const model =
    process.env.LLM_MODEL?.trim() || 'openrouter/auto';

  const baseURL =
    process.env.LLM_BASE_URL?.trim() ||
    'https://openrouter.ai/api/v1';

  let parsedBaseURL: URL;

  try {
    parsedBaseURL = new URL(baseURL);
  } catch {
    throw new Error(
      `Invalid LLM_BASE_URL: ${baseURL}`
    );
  }

  if (
    !['http:', 'https:'].includes(parsedBaseURL.protocol)
  ) {
    throw new Error(
      'LLM_BASE_URL must use HTTP or HTTPS.'
    );
  }

  const temperatureValue =
    process.env.LLM_TEMPERATURE ?? 'none';

  const temperature =
    temperatureValue.toLowerCase() === 'none'
      ? undefined
      : Number(temperatureValue);

  if (
    temperature !== undefined &&
    (
      !Number.isFinite(temperature) ||
      temperature < 0 ||
      temperature > 2
    )
  ) {
    throw new Error(
      'LLM_TEMPERATURE must be between 0 and 2, or "none".'
    );
  }

  return {
    apiKey,
    model,
    baseURL,
    ...(temperature !== undefined
      ? { temperature }
      : {}),
    jsonMode:
      (process.env.LLM_JSON_MODE ?? 'json_object')
        .toLowerCase() !== 'off'
  };
}

function normalizeOrigins(
  values: string[] = []
): string[] {
  return values.map((value) => {
    let parsed: URL;

    try {
      parsed = new URL(value);
    } catch {
      throw new Error(
        `Invalid --allow-origin value: ${value}`
      );
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol)
    ) {
      throw new Error(
        `Only HTTP(S) origins are allowed: ${value}`
      );
    }

    return parsed.origin;
  });
}

function buildRunConfig(
  url: string,
  test: string,
  values: ReturnType<typeof parseCli>['values']
): RunConfig {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (
    !['http:', 'https:'].includes(parsedUrl.protocol)
  ) {
    throw new Error(
      'Only HTTP and HTTPS URLs are supported.'
    );
  }

  if (!test.trim()) {
    throw new Error(
      'The --test instruction cannot be empty.'
    );
  }

  const maxSteps = Number(
    values['max-steps'] ?? '25'
  );

  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > 100
  ) {
    throw new Error(
      '--max-steps must be an integer between 1 and 100.'
    );
  }

  return {
    url: parsedUrl.toString(),
    test: test.trim(),
    data: loadData(values.data ?? []),
    headed: Boolean(values.headed),
    maxSteps,
    outDir: resolve(
      String(values.out ?? 'artifacts')
    ),
    allowedOrigins: normalizeOrigins(
      values['allow-origin'] ?? []
    ),
    llm: loadLlmConfig()
  };
}

async function runSuite(
  pathArgument: string | undefined,
  values: ReturnType<typeof parseCli>['values']
): Promise<number> {
  const suitePath = resolve(
    pathArgument ?? 'examples/suite.json'
  );

  const raw = await readFile(suitePath, 'utf8');
  const parsedJson: unknown = JSON.parse(raw);
  const suite = SuiteSchema.parse(parsedJson) as SuiteCase[];

  if (!suite.length) {
    throw new Error(
      'The suite file contains no test cases.'
    );
  }

  const results: Array<{
    test: SuiteCase;
    verdict: 'PASS' | 'FAIL' | 'ERROR';
    durationMs: number;
  }> = [];

  for (const testCase of suite) {
    console.log(`\n=== ${testCase.name} ===`);

    const config = buildRunConfig(
      testCase.url,
      testCase.test,
      values
    );

    const result = await runTest(config);

    results.push({
      test: testCase,
      verdict: result.verdict,
      durationMs: result.durationMs
    });
  }

  return printSuite(results) ? 0 : 1;
}

async function main(): Promise<number> {
  const { values, positionals } = parseCli();

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  if (values.suite) {
    return runSuite(positionals[0], values);
  }

  if (positionals.length) {
    throw new Error(
      `Unexpected positional argument: ${positionals[0]}. Use --help for usage.`
    );
  }

  if (!values.url || !values.test) {
    throw new Error(
      'Both --url and --test are required. Use --help for usage.'
    );
  }

  const config = buildRunConfig(
    values.url,
    values.test,
    values
  );

  const result = await runTest(config);

  if (result.verdict === 'PASS') return 0;
  if (result.verdict === 'FAIL') return 1;

  return 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      `ERROR: ${error instanceof Error
        ? error.message
        : String(error)
      }`
    );

    process.exitCode = 2;
  });

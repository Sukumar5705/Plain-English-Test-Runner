import { z } from 'zod';

const reason = z.string().trim().min(1).max(200);
const ref = z.number().int().positive();

export const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), url: z.string().url(), reason }).strict(),
  z.object({ action: z.literal('click'), ref, reason }).strict(),
  z.object({ action: z.literal('fill'), ref, value: z.string(), reason }).strict(),
  z.object({ action: z.literal('select'), ref, option: z.string(), reason }).strict(),
  z.object({ action: z.literal('check'), ref, reason }).strict(),
  z.object({ action: z.literal('press'), key: z.string().min(1).max(40), reason }).strict(),
  z.object({ action: z.literal('assertVisible'), text: z.string().min(1), reason }).strict(),
  z.object({ action: z.literal('assertNotVisible'), text: z.string().min(1), reason }).strict(),
  z.object({ action: z.literal('assertUrl'), contains: z.string().min(1), reason }).strict(),
  z.object({ action: z.literal('finish'), status: z.enum(['done', 'blocked']), reason }).strict()
]);

export type Action = z.infer<typeof ActionSchema>;
export type Verdict = 'PASS' | 'FAIL' | 'ERROR';

export type ElementInfo = {
  ref: number;
  role: string;
  name: string;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  checked?: boolean;
  options?: string[];
};

export type Observation = {
  url: string;
  title: string;
  elements: ElementInfo[];
  headings: string[];
  alerts: string[];
  text: string;
};

export type Target = { role: string; name: string; nth?: number; type?: string; placeholder?: string };

export type StepRecord = {
  n: number;
  action: Action;
  target?: Target;
  status: 'ok' | 'failed';
  error?: string;
  urlBefore: string;
  urlAfter: string;
  screenshot: string;
  ms: number;
  observation?: Observation;
};

export type AssertionRecord = {
  action: 'assertVisible' | 'assertNotVisible' | 'assertUrl';
  expected: string;
  reason: string;
  status: 'passed' | 'failed';
};

export type FailureEvidence = {
  expected: string;
  actualUrl: string;
  textExcerpt: string;
  screenshot: string;
};

export type RunResult = {
  verdict: Verdict;
  reason: string;
  weakEvidence: boolean;
  assertions: { passed: number; failed: number };
  assertionDetails: AssertionRecord[];
  steps: StepRecord[];
  failure?: FailureEvidence;
  goal: string;
  startUrl: string;
  startedAt: string;
  durationMs: number;
  config: Record<string, unknown>;
};

export type LlmConfig = {
  apiKey: string;
  model: string;
  baseURL: string;
  temperature?: number;
  jsonMode: boolean;
};

export type RunConfig = {
  url: string;
  test: string;
  data: Record<string, string>;
  headed: boolean;
  maxSteps: number;
  outDir: string;
  allowedOrigins: string[];
  llm: LlmConfig;
};

export type AgentContext = {
  goal: string;
  startUrl: string;
  dataKeys: string[];
  step: number;
  maxSteps: number;
  history: StepRecord[];
  observation: Observation;
  lastError: string | null;
};

export type SuiteCase = {
  name: string;
  url: string;
  test: string;
  expect: Verdict;
};

export const SuiteSchema = z.array(z.object({
  name: z.string().min(1),
  url: z.string().url(),
  test: z.string().min(1),
  expect: z.enum(['PASS', 'FAIL', 'ERROR'])
}).strict());

export function isAssertion(action: Action): action is Extract<Action, { action: 'assertVisible' | 'assertNotVisible' | 'assertUrl' }> {
  return action.action === 'assertVisible' || action.action === 'assertNotVisible' || action.action === 'assertUrl';
}

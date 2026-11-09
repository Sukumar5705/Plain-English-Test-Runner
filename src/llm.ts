
import {
  ActionSchema,
  type Action,
  type AgentContext,
  type LlmConfig
} from './schema.js';

import { buildTurn, SYSTEM_PROMPT } from './prompt.js';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'LlmHttpError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseModelAction(content: string): Action {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  const parsed: unknown = JSON.parse(cleaned);

  return ActionSchema.parse(parsed);
}

function getResponseContent(payload: unknown): string | null {
  const root = asRecord(payload);
  const choices = root?.choices;

  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = message?.content;

  if (typeof content === 'string') {
    return content.trim() || null;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => asRecord(part)?.text)
      .filter((part): part is string => typeof part === 'string')
      .join('')
      .trim();

    return text || null;
  }

  return null;
}

function getProviderError(
  payload: unknown,
  fallback: string
): string {
  const root = asRecord(payload);
  const error = root?.error;

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  const providerError = asRecord(error);
  const message = providerError?.message;

  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }

  return fallback;
}

function isOpenRouterAuto(config: LlmConfig): boolean {
  if (config.model !== 'openrouter/auto') {
    return false;
  }

  try {
    const hostname = new URL(config.baseURL).hostname;

    return hostname === 'openrouter.ai';
  } catch {
    return false;
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof LlmHttpError) {
    return (
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    );
  }

  return (
    error instanceof Error &&
    /timeout|network|fetch|connection|socket|temporarily/i.test(
      error.message
    )
  );
}

function isJsonModeUnsupported(error: unknown): boolean {
  if (!(error instanceof LlmHttpError)) {
    return false;
  }

  if (error.status !== 400 && error.status !== 422) {
    return false;
  }

  return /response_format|json.?object|structured output/i.test(
    error.message
  );
}

function buildEndpoint(baseURL: string): string {
  const normalized = baseURL.replace(/\/+$/, '');

  if (normalized.endsWith('/chat/completions')) {
    return normalized;
  }

  return `${normalized}/chat/completions`;
}

async function postCompletion(
  messages: ChatMessage[],
  config: LlmConfig,
  useJsonMode: boolean
): Promise<string> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    max_tokens: 1024

  };

  if (config.temperature !== undefined) {
    body.temperature = config.temperature;
  }

  if (useJsonMode) {
    body.response_format = {
      type: 'json_object'
    };
  }

  // OpenRouter Auto Router: favor lower-cost capable models.
  if (isOpenRouterAuto(config)) {
    body.plugins = [
      {
        id: 'auto-router',
        cost_tier: 'low'
      }
    ];
  }

  const response = await fetch(buildEndpoint(config.baseURL), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Plain-English Test Runner'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000)
  });

  const responseText = await response.text();

  let payload: unknown = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = getProviderError(
      payload,
      responseText || response.statusText || 'Unknown API error'
    );

    throw new LlmHttpError(
      response.status,
      `OpenRouter API error (${response.status}): ${message}`
    );
  }

  const content = getResponseContent(payload);

  if (!content) {
    throw new Error(
      'OpenRouter returned an empty or unsupported response. ' +
      'Expected choices[0].message.content.'
    );
  }

  return content;
}

async function requestCompletion(
  messages: ChatMessage[],
  config: LlmConfig
): Promise<string> {
  let useJsonMode = config.jsonMode;
  let retryCount = 0;
  let lastError: unknown;

  while (retryCount < 2) {
    try {
      return await postCompletion(
        messages,
        config,
        useJsonMode
      );
    } catch (error) {
      lastError = error;

      // Some routed models may not support JSON response mode.
      // Retry that request without response_format.
      if (useJsonMode && isJsonModeUnsupported(error)) {
        useJsonMode = false;
        continue;
      }

      if (!isRetryable(error) || retryCount >= 1) {
        break;
      }

      retryCount += 1;

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 700);
      });
    }
  }

  const message =
    lastError instanceof Error
      ? lastError.message
      : String(lastError);

  throw new Error(`LLM request failed: ${message}`);
}

export async function nextAction(
  context: AgentContext,
  config: LlmConfig
): Promise<Action> {
  const baseMessages: ChatMessage[] = [
    {
      role: 'system',
      content: SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: buildTurn(context)
    }
  ];

  const raw = await requestCompletion(
    baseMessages,
    config
  );

  try {
    return parseModelAction(raw);
  } catch (firstError) {
    const validationMessage =
      firstError instanceof Error
        ? firstError.message
        : String(firstError);

    const repairMessages: ChatMessage[] = [
      ...baseMessages,
      {
        role: 'assistant',
        content: raw
      },
      {
        role: 'user',
        content:
          `Your previous response was invalid. ` +
          `Validation error: ${validationMessage}. ` +
          'Return exactly one corrected JSON action using the allowed schema. ' +
          'Do not add Markdown or explanations.'
      }
    ];

    const repaired = await requestCompletion(
      repairMessages,
      config
    );

    try {
      return parseModelAction(repaired);
    } catch (secondError) {
      const lastValidationError =
        secondError instanceof Error
          ? secondError.message
          : String(secondError);

      throw new Error(
        'Model returned invalid actions twice. ' +
        `Last validation error: ${lastValidationError}`
      );
    }
  }
}

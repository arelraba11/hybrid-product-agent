// packages/server/llm/config.ts
// Per-component provider config: <COMPONENT>_PROVIDER, _MODEL, _MAX_TOKENS, _REASONING_EFFORT, _THINK.
// Plus LLM_TIMEOUT_MS, a per-call timeout shared by every component and embeddings.
import { z } from 'zod';
import {
   COMPONENTS,
   PROVIDERS,
   REASONING_EFFORTS,
   type Component,
   type ComponentConfig,
   type LlmUsage,
   type Provider,
} from './types';

export const OLLAMA_URL = (
   process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
).replace(/\/$/, '');

const timeoutParsed = z.coerce
   .number()
   .int()
   .positive()
   .default(60_000)
   .safeParse(process.env.LLM_TIMEOUT_MS || undefined);
if (!timeoutParsed.success) {
   throw new Error(
      `Invalid LLM_TIMEOUT_MS: ${z.prettifyError(timeoutParsed.error)}`
   );
}
/** Per-call timeout (ms) for every LLM and embedding request; the request is aborted. */
export const LLM_TIMEOUT_MS = timeoutParsed.data;

// Used when <COMPONENT>_MAX_TOKENS is unset. Ollama gets no limit (model default).
const DEFAULT_OPENAI_MAX_TOKENS = 1024;

const ENV_PREFIX: Record<Component, string> = {
   planner: 'PLANNER',
   plannerFallback: 'PLANNER_FALLBACK',
   chat: 'CHAT',
   rag: 'RAG',
   reviews: 'REVIEWS',
   synthesis: 'SYNTHESIS',
   math: 'MATH',
   judge: 'JUDGE',
};

const DEFAULTS: Record<Component, { provider: Provider; model: string }> = {
   planner: { provider: 'ollama', model: 'gemma4:12b' },
   plannerFallback: { provider: 'openai', model: 'gpt-5.4-mini' },
   chat: { provider: 'ollama', model: 'gemma4:12b' },
   rag: { provider: 'openai', model: 'gpt-5.4-mini' },
   reviews: { provider: 'openai', model: 'gpt-5.4-mini' },
   synthesis: { provider: 'openai', model: 'gpt-5.4-mini' },
   math: { provider: 'openai', model: 'gpt-5.4-mini' },
   judge: { provider: 'openai', model: 'gpt-5.4-mini' },
};

const componentSchema = z.object({
   provider: z.enum(PROVIDERS),
   model: z.string().trim().min(1),
   maxTokens: z.coerce.number().int().positive().optional(),
   reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
   think: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
});

function readComponent(
   component: Component,
   env: NodeJS.ProcessEnv
): ComponentConfig {
   const prefix = ENV_PREFIX[component];
   const defaults = DEFAULTS[component];

   const parsed = componentSchema.safeParse({
      provider: env[`${prefix}_PROVIDER`] || defaults.provider,
      model: env[`${prefix}_MODEL`] || defaults.model,
      maxTokens: env[`${prefix}_MAX_TOKENS`] || undefined,
      reasoningEffort: env[`${prefix}_REASONING_EFFORT`] || undefined,
      think: env[`${prefix}_THINK`] || undefined,
   });

   if (!parsed.success) {
      throw new Error(
         `Invalid LLM config for ${prefix}_*: ${z.prettifyError(parsed.error)}`
      );
   }

   const cfg = parsed.data;
   if (cfg.maxTokens === undefined && cfg.provider === 'openai') {
      cfg.maxTokens = DEFAULT_OPENAI_MAX_TOKENS;
   }
   return cfg;
}

export function loadLlmConfig(
   env: NodeJS.ProcessEnv = process.env
): Record<Component, ComponentConfig> {
   return Object.fromEntries(
      COMPONENTS.map((c) => [c, readComponent(c, env)])
   ) as Record<Component, ComponentConfig>;
}

export const llmConfig = loadLlmConfig();

export function describeLlmConfig(): string {
   const lines = COMPONENTS.map((c) => {
      const cfg = llmConfig[c];
      const extras = [
         cfg.maxTokens ? `maxTokens=${cfg.maxTokens}` : null,
         cfg.reasoningEffort ? `effort=${cfg.reasoningEffort}` : null,
         cfg.think !== undefined && cfg.provider === 'ollama'
            ? `think=${cfg.think}`
            : null,
      ].filter(Boolean);
      return `  ${c.padEnd(16)} ${cfg.provider}/${cfg.model}${extras.length ? ` (${extras.join(', ')})` : ''}`;
   });
   lines.push(`  ${'timeout'.padEnd(16)} ${LLM_TIMEOUT_MS}ms per call`);
   return lines.join('\n');
}

// USD per 1M tokens, OpenAI list prices (checked 2026-10). Cached-input discounts are
// ignored, so costs are an upper bound. Ollama runs locally and costs 0.
const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
   'gpt-5.4-mini': { input: 0.75, output: 4.5 },
   'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

const warnedUnpriced = new Set<string>();

/** null when the model has no price entry or the provider reported no usage. */
export function costFor(
   provider: Provider,
   model: string,
   usage: LlmUsage | null
): number | null {
   if (provider === 'ollama') return 0;

   const price = OPENAI_PRICING[model];
   if (!price) {
      if (!warnedUnpriced.has(model)) {
         warnedUnpriced.add(model);
         console.warn(
            `[llm] No price for ${model}; cost will be reported as null.`
         );
      }
      return null;
   }
   if (!usage) return null;

   return (
      (usage.inputTokens * price.input + usage.outputTokens * price.output) /
      1_000_000
   );
}

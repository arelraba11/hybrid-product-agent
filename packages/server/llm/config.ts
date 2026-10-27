// packages/server/llm/config.ts
// Per-component provider config: <COMPONENT>_PROVIDER, _MODEL, _MAX_TOKENS, _REASONING_EFFORT.
import { z } from 'zod';
import {
   COMPONENTS,
   PROVIDERS,
   REASONING_EFFORTS,
   type Component,
   type ComponentConfig,
   type Provider,
} from './types';

export const OLLAMA_URL = (
   process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
).replace(/\/$/, '');

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
};

const DEFAULTS: Record<Component, { provider: Provider; model: string }> = {
   planner: { provider: 'ollama', model: 'gemma4:12b' },
   plannerFallback: { provider: 'openai', model: 'gpt-5.4-mini' },
   chat: { provider: 'ollama', model: 'gemma4:12b' },
   rag: { provider: 'openai', model: 'gpt-5.4-mini' },
   reviews: { provider: 'openai', model: 'gpt-5.4-mini' },
   synthesis: { provider: 'openai', model: 'gpt-5.4-mini' },
   math: { provider: 'openai', model: 'gpt-5.4-mini' },
};

const componentSchema = z.object({
   provider: z.enum(PROVIDERS),
   model: z.string().trim().min(1),
   maxTokens: z.coerce.number().int().positive().optional(),
   reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
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
   return COMPONENTS.map((c) => {
      const cfg = llmConfig[c];
      const extras = [
         cfg.maxTokens ? `maxTokens=${cfg.maxTokens}` : null,
         cfg.reasoningEffort ? `effort=${cfg.reasoningEffort}` : null,
      ].filter(Boolean);
      return `  ${c.padEnd(16)} ${cfg.provider}/${cfg.model}${extras.length ? ` (${extras.join(', ')})` : ''}`;
   }).join('\n');
}

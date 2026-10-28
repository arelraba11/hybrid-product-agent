// packages/server/llm/index.ts
// Provider-agnostic entry point. Services name a component; config picks provider + model.
import type { z } from 'zod';
import { costFor, LLM_TIMEOUT_MS, llmConfig } from './config';
import { generateOllama } from './ollama.provider';
import { generateOpenAI } from './openai.provider';
import { recordLlmCall } from './usage';
import type {
   Component,
   ComponentConfig,
   GenerateOptions,
   ProviderResult,
} from './types';

// Some local models still wrap JSON in markdown fences.
function stripMarkdownJson(text: string) {
   let t = text.trim();
   if (t.startsWith('```json')) t = t.replace(/^```json\s*/i, '');
   if (t.startsWith('```')) t = t.replace(/^```\s*/i, '');
   if (t.endsWith('```')) t = t.replace(/\s*```$/, '');
   return t.trim();
}

function callProvider(
   cfg: ComponentConfig,
   opts: GenerateOptions,
   signal: AbortSignal
): Promise<ProviderResult> {
   switch (cfg.provider) {
      case 'ollama':
         return generateOllama(cfg, opts, signal);
      case 'openai':
         return generateOpenAI(cfg, opts, signal);
   }
}

export const llm = {
   /**
    * Every call (including failures) is recorded for the active trace, if any.
    * Aborted after LLM_TIMEOUT_MS; the timeout surfaces as a normal error (callers' fallbacks apply).
    */
   async generate(
      component: Component,
      opts: GenerateOptions
   ): Promise<string> {
      const cfg = llmConfig[component];
      const base = { component, provider: cfg.provider, model: cfg.model };
      const start = performance.now();
      const signal = AbortSignal.timeout(LLM_TIMEOUT_MS);

      try {
         const { text, usage, thinkingChars } = await callProvider(
            cfg,
            opts,
            signal
         );
         recordLlmCall({
            ...base,
            latencyMs: performance.now() - start,
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            costUsd: costFor(cfg.provider, cfg.model, usage),
            ...(thinkingChars !== undefined && { thinkingChars }),
         });
         return text;
      } catch (err) {
         const error = signal.aborted
            ? new Error(
                 `${component} (${cfg.provider}/${cfg.model}) timed out after ${LLM_TIMEOUT_MS}ms`
              )
            : err;
         recordLlmCall({
            ...base,
            latencyMs: performance.now() - start,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            error: error instanceof Error ? error.message : String(error),
         });
         throw error;
      }
   },

   /** Structured output enforced by the provider, then validated with the same zod schema. */
   async generateObject<S extends z.ZodType>(
      component: Component,
      schema: S,
      name: string,
      opts: Omit<GenerateOptions, 'responseFormat'>
   ): Promise<{ raw: string; data: z.infer<S> }> {
      const raw = await this.generate(component, {
         ...opts,
         responseFormat: { type: 'json_schema', name, schema },
      });
      return { raw, data: schema.parse(JSON.parse(stripMarkdownJson(raw))) };
   },
};

export type { Component, GenerateOptions } from './types';
export { collectLlmCalls, type LlmCall } from './usage';

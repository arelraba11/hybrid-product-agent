// packages/server/llm/index.ts
// Provider-agnostic entry point. Services name a component; config picks provider + model.
import type { z } from 'zod';
import { costFor, llmConfig } from './config';
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
   opts: GenerateOptions
): Promise<ProviderResult> {
   switch (cfg.provider) {
      case 'ollama':
         return generateOllama(cfg, opts);
      case 'openai':
         return generateOpenAI(cfg, opts);
   }
}

export const llm = {
   /** Every call (including failures) is recorded for the active trace, if any. */
   async generate(
      component: Component,
      opts: GenerateOptions
   ): Promise<string> {
      const cfg = llmConfig[component];
      const base = { component, provider: cfg.provider, model: cfg.model };
      const start = performance.now();

      try {
         const { text, usage } = await callProvider(cfg, opts);
         recordLlmCall({
            ...base,
            latencyMs: performance.now() - start,
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            costUsd: costFor(cfg.provider, cfg.model, usage),
         });
         return text;
      } catch (err) {
         recordLlmCall({
            ...base,
            latencyMs: performance.now() - start,
            inputTokens: null,
            outputTokens: null,
            costUsd: null,
            error: err instanceof Error ? err.message : String(err),
         });
         throw err;
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

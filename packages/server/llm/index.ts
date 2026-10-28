// packages/server/llm/index.ts
// Provider-agnostic entry point. Services name a component; config picks provider + model.
import type { z } from 'zod';
import { costFor, LLM_TIMEOUT_MS, llmConfig } from './config';
import { chatOllama, generateOllama } from './ollama.provider';
import { chatOpenAI, generateOpenAI } from './openai.provider';
import { recordLlmCall } from './usage';
import type {
   ChatRequest,
   ChatResult,
   Component,
   ComponentConfig,
   GenerateOptions,
   LlmUsage,
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

type Usage = { usage: LlmUsage | null; thinkingChars?: number };

/**
 * Runs one provider call with the per-call timeout and records it (including failures)
 * for the active trace, if any. A timeout surfaces as a normal error (callers' fallbacks apply).
 */
async function recordedCall<T extends Usage>(
   component: Component,
   run: (cfg: ComponentConfig, signal: AbortSignal) => Promise<T>
): Promise<T> {
   const cfg = llmConfig[component];
   const base = { component, provider: cfg.provider, model: cfg.model };
   const start = performance.now();
   const signal = AbortSignal.timeout(LLM_TIMEOUT_MS);

   try {
      const result = await run(cfg, signal);
      const { usage, thinkingChars } = result;
      recordLlmCall({
         ...base,
         latencyMs: performance.now() - start,
         inputTokens: usage?.inputTokens ?? null,
         outputTokens: usage?.outputTokens ?? null,
         costUsd: costFor(cfg.provider, cfg.model, usage),
         ...(thinkingChars !== undefined && { thinkingChars }),
      });
      return result;
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
}

export const llm = {
   /** Aborted after LLM_TIMEOUT_MS; every call is recorded for the active trace, if any. */
   async generate(
      component: Component,
      opts: GenerateOptions
   ): Promise<string> {
      const { text } = await recordedCall(component, (cfg, signal) =>
         callProvider(cfg, opts, signal)
      );
      return text;
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

   /**
    * One model turn with native tool calling. Tool calls are returned unvalidated
    * (raw argument text); the caller validates them against the tool's zod schema.
    */
   async chat(component: Component, req: ChatRequest): Promise<ChatResult> {
      const {
         usage: _usage,
         thinkingChars: _thinking,
         ...result
      } = await recordedCall(component, (cfg, signal) => {
         switch (cfg.provider) {
            case 'ollama':
               return chatOllama(cfg, req, signal);
            case 'openai':
               return chatOpenAI(cfg, req, signal);
         }
      });
      return result;
   },
};

export type {
   ChatRequest,
   ChatResult,
   Component,
   GenerateOptions,
   LlmMessage,
   ToolCall,
   ToolSpec,
} from './types';
export { collectLlmCalls, type LlmCall } from './usage';

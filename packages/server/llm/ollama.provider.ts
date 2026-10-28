// packages/server/llm/ollama.provider.ts
import { z } from 'zod';
import { OLLAMA_URL } from './config';
import type {
   ComponentConfig,
   GenerateOptions,
   ProviderResult,
   ResponseFormat,
} from './types';

type OllamaGenerateResponse = {
   response: string;
   /** Thinking models: the reasoning trace, split out of `response` by Ollama's parser. */
   thinking?: string;
   prompt_eval_count?: number;
   eval_count?: number;
};

type OllamaOptions = {
   temperature?: number;
   num_predict?: number;
   stop?: string[];
};

// Ollama's `format` accepts "json" or a JSON schema.
function toOllamaFormat(
   format: ResponseFormat | undefined
): 'json' | Record<string, unknown> | undefined {
   switch (format?.type) {
      case 'json_object':
         return 'json';
      case 'json_schema':
         return z.toJSONSchema(format.schema);
      default:
         return undefined;
   }
}

export async function generateOllama(
   cfg: ComponentConfig,
   { prompt, temperature, stop, responseFormat }: GenerateOptions,
   signal: AbortSignal
): Promise<ProviderResult> {
   const options: OllamaOptions = {};
   if (temperature !== undefined) options.temperature = temperature;
   if (cfg.maxTokens !== undefined) options.num_predict = cfg.maxTokens;
   if (stop?.length) options.stop = stop;

   // Aborting closes the connection, which also stops generation on the Ollama side.
   const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
         model: cfg.model,
         prompt,
         stream: false,
         format: toOllamaFormat(responseFormat),
         // Only when configured: models without the thinking capability reject `think: true`.
         ...(cfg.think !== undefined && { think: cfg.think }),
         options,
      }),
   });

   if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
         `Ollama error: ${res.status} ${res.statusText} - ${text}`
      );
   }

   const data = (await res.json()) as OllamaGenerateResponse;
   const hasUsage =
      data.prompt_eval_count !== undefined || data.eval_count !== undefined;
   // eval_count includes thinking tokens; Ollama reports no separate count, so only its length is kept.
   return {
      text: data.response,
      ...(data.thinking && { thinkingChars: data.thinking.length }),
      usage: hasUsage
         ? {
              inputTokens: data.prompt_eval_count ?? 0,
              outputTokens: data.eval_count ?? 0,
           }
         : null,
   };
}

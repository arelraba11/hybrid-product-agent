// packages/server/llm/openai.provider.ts
import OpenAI from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import type { ComponentConfig, GenerateOptions } from './types';

let client: OpenAI | null = null;

// Lazy so the server can start fully local without an OpenAI key.
function getClient() {
   client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
   return client;
}

export async function generateOpenAI(
   cfg: ComponentConfig,
   { prompt, temperature }: GenerateOptions
): Promise<string> {
   const params: ResponseCreateParamsNonStreaming = {
      model: cfg.model,
      input: prompt,
      max_output_tokens: cfg.maxTokens,
   };

   if (cfg.reasoningEffort) {
      params.reasoning = { effort: cfg.reasoningEffort };
   }

   // Reasoning models reject temperature unless effort is 'none' (or left at the model default).
   const reasoningActive =
      cfg.reasoningEffort !== undefined && cfg.reasoningEffort !== 'none';
   if (temperature !== undefined && !reasoningActive) {
      params.temperature = temperature;
   }

   const response = await getClient().responses.create(params);
   return response.output_text;
}

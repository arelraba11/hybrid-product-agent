// packages/server/llm/openai.provider.ts
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type {
   ResponseCreateParamsNonStreaming,
   ResponseFormatTextConfig,
} from 'openai/resources/responses/responses';
import type {
   ComponentConfig,
   GenerateOptions,
   ProviderResult,
   ResponseFormat,
} from './types';

let client: OpenAI | null = null;

// Lazy so the server can start fully local without an OpenAI key.
function getClient() {
   client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
   return client;
}

// Responses API structured output lives under text.format (not response_format).
function toTextFormat(format: ResponseFormat): ResponseFormatTextConfig {
   switch (format.type) {
      case 'text':
         return { type: 'text' };
      case 'json_object':
         return { type: 'json_object' };
      case 'json_schema':
         return zodTextFormat(format.schema, format.name);
   }
}

export async function generateOpenAI(
   cfg: ComponentConfig,
   { prompt, temperature, responseFormat }: GenerateOptions
): Promise<ProviderResult> {
   const params: ResponseCreateParamsNonStreaming = {
      model: cfg.model,
      input: prompt,
      max_output_tokens: cfg.maxTokens,
   };

   if (responseFormat) {
      params.text = { format: toTextFormat(responseFormat) };
   }

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
   return {
      text: response.output_text,
      usage: response.usage
         ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
           }
         : null,
   };
}

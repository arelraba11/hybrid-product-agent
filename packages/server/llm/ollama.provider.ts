// packages/server/llm/ollama.provider.ts
import { OLLAMA_URL } from './config';
import type { ComponentConfig, GenerateOptions } from './types';

type OllamaGenerateResponse = { response: string };

type OllamaOptions = {
   temperature?: number;
   num_predict?: number;
   stop?: string[];
};

export async function generateOllama(
   cfg: ComponentConfig,
   { prompt, temperature, stop }: GenerateOptions
): Promise<string> {
   const options: OllamaOptions = {};
   if (temperature !== undefined) options.temperature = temperature;
   if (cfg.maxTokens !== undefined) options.num_predict = cfg.maxTokens;
   if (stop?.length) options.stop = stop;

   const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
         model: cfg.model,
         prompt,
         stream: false,
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
   return data.response;
}

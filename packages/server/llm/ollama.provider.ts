// packages/server/llm/ollama.provider.ts
import { z } from 'zod';
import { OLLAMA_URL } from './config';
import type {
   ChatRequest,
   ComponentConfig,
   GenerateOptions,
   LlmMessage,
   LlmUsage,
   ProviderChatResult,
   ProviderResult,
   ResponseFormat,
   ToolSpec,
} from './types';

type Counts = { prompt_eval_count?: number; eval_count?: number };

type OllamaGenerateResponse = Counts & {
   response: string;
   /** Thinking models: the reasoning trace, split out of `response` by Ollama's parser. */
   thinking?: string;
};

type OllamaToolCall = {
   id?: string;
   function: { name: string; arguments: Record<string, unknown> | string };
};

type OllamaChatMessage = {
   role: 'system' | 'user' | 'assistant' | 'tool';
   content: string;
   thinking?: string;
   tool_calls?: OllamaToolCall[];
   tool_name?: string;
};

type OllamaChatResponse = Counts & {
   message: OllamaChatMessage;
   done_reason?: string;
};

type OllamaOptions = {
   temperature?: number;
   num_predict?: number;
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

function buildOptions(
   cfg: ComponentConfig,
   temperature?: number
): OllamaOptions {
   const options: OllamaOptions = {};
   if (temperature !== undefined) options.temperature = temperature;
   if (cfg.maxTokens !== undefined) options.num_predict = cfg.maxTokens;
   return options;
}

// Only when configured: models without the thinking capability reject `think: true`.
function thinkField(cfg: ComponentConfig) {
   return cfg.think !== undefined ? { think: cfg.think } : {};
}

async function postOllama<T>(
   path: string,
   body: Record<string, unknown>,
   signal: AbortSignal
): Promise<T> {
   // Aborting closes the connection, which also stops generation on the Ollama side.
   const res = await fetch(`${OLLAMA_URL}${path}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
   });

   if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
         `Ollama error: ${res.status} ${res.statusText} - ${text}`
      );
   }
   return (await res.json()) as T;
}

// eval_count includes thinking tokens; Ollama reports no separate count, so only its length is kept.
function usageOf(data: Counts): LlmUsage | null {
   const hasUsage =
      data.prompt_eval_count !== undefined || data.eval_count !== undefined;
   return hasUsage
      ? {
           inputTokens: data.prompt_eval_count ?? 0,
           outputTokens: data.eval_count ?? 0,
        }
      : null;
}

export async function generateOllama(
   cfg: ComponentConfig,
   { prompt, temperature, responseFormat }: GenerateOptions,
   signal: AbortSignal
): Promise<ProviderResult> {
   const data = await postOllama<OllamaGenerateResponse>(
      '/api/generate',
      {
         model: cfg.model,
         prompt,
         stream: false,
         format: toOllamaFormat(responseFormat),
         ...thinkField(cfg),
         options: buildOptions(cfg, temperature),
      },
      signal
   );

   return {
      text: data.response,
      ...(data.thinking && { thinkingChars: data.thinking.length }),
      usage: usageOf(data),
   };
}

function toOllamaTool(spec: ToolSpec) {
   return {
      type: 'function',
      function: {
         name: spec.name,
         description: spec.description,
         parameters: z.toJSONSchema(spec.schema),
      },
   };
}

// Ollama wants tool-call arguments back as an object; unparseable ones are sent as {}
// (the tool message that follows carries the validation error).
function argumentsObject(raw: string): Record<string, unknown> {
   try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
         ? (parsed as Record<string, unknown>)
         : {};
   } catch {
      return {};
   }
}

function toOllamaMessage(m: LlmMessage): OllamaChatMessage {
   switch (m.role) {
      case 'system':
      case 'user':
         return { role: m.role, content: m.content };
      case 'assistant':
         return {
            role: 'assistant',
            content: m.content,
            ...(m.toolCalls.length && {
               tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  function: {
                     name: c.name,
                     arguments: argumentsObject(c.arguments),
                  },
               })),
            }),
         };
      case 'tool':
         return { role: 'tool', content: m.content, tool_name: m.name };
   }
}

export async function chatOllama(
   cfg: ComponentConfig,
   { messages, tools, temperature }: ChatRequest,
   signal: AbortSignal
): Promise<ProviderChatResult> {
   const data = await postOllama<OllamaChatResponse>(
      '/api/chat',
      {
         model: cfg.model,
         messages: messages.map(toOllamaMessage),
         tools: tools.map(toOllamaTool),
         stream: false,
         ...thinkField(cfg),
         options: buildOptions(cfg, temperature),
      },
      signal
   );

   const msg = data.message;
   return {
      text: msg.content ?? '',
      toolCalls: (msg.tool_calls ?? []).map((c, i) => ({
         id: c.id ?? `call_${i}`,
         name: c.function.name,
         arguments:
            typeof c.function.arguments === 'string'
               ? c.function.arguments
               : JSON.stringify(c.function.arguments),
      })),
      truncated: data.done_reason === 'length',
      ...(msg.thinking && { thinkingChars: msg.thinking.length }),
      usage: usageOf(data),
   };
}

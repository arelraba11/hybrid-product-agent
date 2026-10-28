// packages/server/llm/types.ts
import type { z } from 'zod';

export const COMPONENTS = [
   'planner',
   'plannerFallback',
   'chat',
   'rag',
   'reviews',
   'synthesis',
   'math',
   'judge',
] as const;
export type Component = (typeof COMPONENTS)[number];

export const PROVIDERS = ['ollama', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];

// OpenAI reasoning models only. Any value other than 'none' disables temperature.
export const REASONING_EFFORTS = [
   'none',
   'minimal',
   'low',
   'medium',
   'high',
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type ComponentConfig = {
   provider: Provider;
   model: string;
   maxTokens?: number;
   reasoningEffort?: ReasoningEffort;
   /** Ollama only. Sent as `think` only when set; unset leaves the model default (phi3 rejects `think: true`). */
   think?: boolean;
};

// json_schema: the zod schema is the single source of truth for the structured output.
export type ResponseFormat =
   | { type: 'text' }
   | { type: 'json_object' }
   | { type: 'json_schema'; name: string; schema: z.ZodType };

export type LlmUsage = { inputTokens: number; outputTokens: number };

/**
 * What a provider returns; `llm.generate` unwraps it to plain text for callers.
 * thinkingChars: length of a separate reasoning trace (Ollama `thinking`), trace-only, never the text.
 */
export type ProviderResult = {
   text: string;
   usage: LlmUsage | null;
   thinkingChars?: number;
};

export type GenerateOptions = {
   prompt: string;
   temperature?: number;
   responseFormat?: ResponseFormat;
   /** Stop sequences. Honored by Ollama only (the Responses API has no stop parameter). */
   stop?: string[];
};

// ---- Tool calling (llm.chat) ----

/** The zod schema is the single source of truth: providers convert it to JSON schema. */
export type ToolSpec = {
   name: string;
   description: string;
   schema: z.ZodObject;
};

/** `arguments` is the raw JSON text the model produced; callers parse and validate it. */
export type ToolCall = { id: string; name: string; arguments: string };

/**
 * Provider-neutral conversation. `providerItems` is opaque provider state for an assistant
 * turn (OpenAI output items, replayed verbatim so reasoning stays paired with its calls).
 */
export type LlmMessage =
   | { role: 'system'; content: string }
   | { role: 'user'; content: string }
   | {
        role: 'assistant';
        content: string;
        toolCalls: ToolCall[];
        providerItems?: unknown[];
     }
   | { role: 'tool'; toolCallId: string; name: string; content: string };

export type ChatRequest = {
   messages: LlmMessage[];
   tools: ToolSpec[];
   temperature?: number;
};

export type ChatResult = {
   text: string;
   toolCalls: ToolCall[];
   /** Output cut off by the token limit (Ollama done_reason 'length', OpenAI status 'incomplete'). */
   truncated: boolean;
   providerItems?: unknown[];
};

export type ProviderChatResult = ChatResult & {
   usage: LlmUsage | null;
   thinkingChars?: number;
};

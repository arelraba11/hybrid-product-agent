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
};

// json_schema: the zod schema is the single source of truth for the structured output.
export type ResponseFormat =
   | { type: 'text' }
   | { type: 'json_object' }
   | { type: 'json_schema'; name: string; schema: z.ZodType };

export type GenerateOptions = {
   prompt: string;
   temperature?: number;
   responseFormat?: ResponseFormat;
   /** Stop sequences. Honored by Ollama only (the Responses API has no stop parameter). */
   stop?: string[];
};

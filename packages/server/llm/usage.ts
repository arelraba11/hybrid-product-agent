// packages/server/llm/usage.ts
// Per-request record of LLM calls (latency, tokens, cost). Observability only:
// with no active collector, recording is a no-op.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Component, Provider } from './types';

export type LlmCall = {
   component: Component | 'embeddings';
   provider: Provider;
   model: string;
   latencyMs: number;
   inputTokens: number | null;
   outputTokens: number | null;
   costUsd: number | null;
   /** Length of the model's separate thinking trace, when it returned one (Ollama thinking models). */
   thinkingChars?: number;
   error?: string;
};

// Collectors nest: a call is recorded in the innermost scope and every enclosing one.
type Scope = { calls: LlmCall[]; parent: Scope | undefined };

const storage = new AsyncLocalStorage<Scope>();

export async function collectLlmCalls<T>(
   fn: () => Promise<T>
): Promise<{ result: T; calls: LlmCall[] }> {
   const scope: Scope = { calls: [], parent: storage.getStore() };
   const result = await storage.run(scope, fn);
   return { result, calls: scope.calls };
}

export function recordLlmCall(call: LlmCall) {
   for (let s = storage.getStore(); s; s = s.parent) s.calls.push(call);
}

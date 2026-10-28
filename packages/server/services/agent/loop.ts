// Agent loop: the model calls tools, sees the results and decides the next step until it
// stops calling tools. It only selects and runs tools; the caller writes the answer
// (synthesis if any tool ran, chat otherwise).
//
// Failure handling, per attempt: one repair (an invalid turn's errors go back to the model).
// A second invalid turn, a provider error/timeout, truncated or empty output, or more than
// maxIterations turns fails the attempt. A failed primary attempt escalates once: the loop
// restarts from scratch on plannerFallback.
import {
   collectLlmCalls,
   llm,
   type ChatRequest,
   type ChatResult,
   type Component,
   type LlmCall,
   type LlmMessage,
   type ToolCall,
} from '../../llm';
import { AGENT_SYSTEM_PROMPT } from '../../prompts/prompts';
import type { AgentTool, ToolResult } from './tools';

export type ChatFn = (
   component: Component,
   req: ChatRequest
) => Promise<ChatResult>;

export type AgentStep<N extends string = string> = ToolResult & {
   step: number;
   tool: N;
   parameters: Record<string, unknown>;
   latencyMs: number;
   llmCalls: LlmCall[];
};

export type FailureKind =
   | 'validation'
   | 'provider_error'
   | 'truncated'
   | 'empty_output'
   | 'max_iterations';

export type AgentFailure = { kind: FailureKind; message: string };

export type ToolCallTrace = {
   name: string;
   arguments: string;
   /** Validation error; the call was not executed. */
   error?: string;
};

export type IterationTrace = {
   toolCalls: ToolCallTrace[];
   textChars: number;
   /** The text looked like a tool call written out instead of made via the tool interface. */
   textToolCall?: boolean;
   truncated: boolean;
   latencyMs: number;
};

export type AttemptComponent = 'planner' | 'plannerFallback';

export type AttemptTrace<N extends string = string> = {
   component: AttemptComponent;
   iterations: IterationTrace[];
   steps: AgentStep<N>[];
   failure?: AgentFailure;
};

export type Repair = { attempt: number; iteration: number; reason: string };

export type AgentRun<N extends string = string> = {
   outcome: 'done' | 'failed';
   attempts: AttemptTrace<N>[];
   repairs: Repair[];
   escalation?: AgentFailure;
   /** Executed steps of the last attempt: what the answer is built from. */
   steps: AgentStep<N>[];
   /** Why the last attempt failed (outcome 'failed' only). */
   failure?: AgentFailure;
};

export type AgentOptions<N extends string> = {
   tools: AgentTool<N>[];
   maxIterations: number;
   chat?: ChatFn;
   systemPrompt?: string;
};

export const TEXT_TOOL_CALL_REPAIR =
   'You wrote a tool call as text. Call tools via the tool interface, not as text. If no tool is needed, reply in plain words.';

function errorMessage(err: unknown): string {
   return err instanceof Error ? err.message : String(err);
}

function escapeRegex(s: string) {
   return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A tool call written out as text instead of made via the tool interface (a local-model
 * failure mode): the text names a tool and is JSON/fenced, or calls it like a function.
 */
export function looksLikeTextToolCall(text: string, names: string[]): boolean {
   const t = text.trim();
   if (!t) return false;
   return names.some((name) => {
      const n = escapeRegex(name);
      if (!new RegExp(`\\b${n}\\b`).test(t)) return false;
      return (
         /^[{[`]/.test(t) || new RegExp(`\\b${n}\\s*\\(|["']${n}["']`).test(t)
      );
   });
}

type CheckedCall<N extends string> =
   | { call: ToolCall; tool: AgentTool<N>; args: Record<string, unknown> }
   | { call: ToolCall; error: string };

function checkCall<N extends string>(
   call: ToolCall,
   tools: AgentTool<N>[]
): CheckedCall<N> {
   const tool = tools.find((t) => t.name === call.name);
   if (!tool) {
      return {
         call,
         error: `Unknown tool "${call.name}". Available tools: ${tools.map((t) => t.name).join(', ')}.`,
      };
   }

   let json: unknown;
   try {
      json = JSON.parse(call.arguments || '{}');
   } catch {
      return {
         call,
         error: `Arguments for ${call.name} are not valid JSON: ${call.arguments}`,
      };
   }

   const parsed = tool.schema.safeParse(json);
   if (!parsed.success) {
      const issues = parsed.error.issues
         .map((i) => `${i.path.join('.') || '(arguments)'}: ${i.message}`)
         .join('; ');
      return { call, error: `Invalid arguments for ${call.name}: ${issues}` };
   }
   return { call, tool, args: parsed.data as Record<string, unknown> };
}

async function executeCall<N extends string>(
   tool: AgentTool<N>,
   args: Record<string, unknown>
): Promise<Omit<AgentStep<N>, 'step'>> {
   const start = performance.now();
   const { result, calls } = await collectLlmCalls(
      async (): Promise<ToolResult> => {
         try {
            return await tool.execute(args);
         } catch (err) {
            return { ok: false, output: errorMessage(err), numericValue: null };
         }
      }
   );
   return {
      ...result,
      tool: tool.name,
      parameters: args,
      latencyMs: performance.now() - start,
      llmCalls: calls,
   };
}

function toolMessage(step: { ok: boolean; output: string }): string {
   return step.ok ? step.output : `Tool error: ${step.output}`;
}

async function runAttempt<N extends string>(
   component: AttemptComponent,
   attemptNo: number,
   userInput: string,
   opts: Required<AgentOptions<N>>,
   repairs: Repair[]
): Promise<AttemptTrace<N>> {
   const { tools, chat, maxIterations } = opts;
   const names = tools.map((t) => t.name);
   const trace: AttemptTrace<N> = { component, iterations: [], steps: [] };
   const fail = (kind: FailureKind, message: string) => {
      trace.failure = { kind, message };
      return trace;
   };

   const messages: LlmMessage[] = [
      { role: 'system', content: opts.systemPrompt },
      { role: 'user', content: userInput },
   ];
   let repairUsed = false;

   for (let i = 1; ; i++) {
      if (i > maxIterations) {
         return fail(
            'max_iterations',
            `still calling tools after ${maxIterations} iterations`
         );
      }

      const start = performance.now();
      let res: ChatResult;
      try {
         res = await chat(component, { messages, tools, temperature: 0 });
      } catch (err) {
         return fail('provider_error', errorMessage(err));
      }

      const checked = res.toolCalls.map((c) => checkCall(c, tools));
      const textToolCall =
         !res.toolCalls.length && looksLikeTextToolCall(res.text, names);
      trace.iterations.push({
         toolCalls: checked.map((c) => ({
            name: c.call.name,
            arguments: c.call.arguments,
            ...('error' in c && { error: c.error }),
         })),
         textChars: res.text.length,
         ...(textToolCall && { textToolCall }),
         truncated: res.truncated,
         latencyMs: performance.now() - start,
      });

      if (res.truncated) {
         return fail('truncated', 'output hit the token limit');
      }

      const errors = checked.flatMap((c) => ('error' in c ? [c.error] : []));
      if (textToolCall) errors.push('tool call emitted as text');

      if (errors.length) {
         if (repairUsed) {
            return fail('validation', `after repair: ${errors.join(' | ')}`);
         }
         repairUsed = true;
         repairs.push({
            attempt: attemptNo,
            iteration: i,
            reason: errors.join(' | '),
         });
      }

      messages.push({
         role: 'assistant',
         content: res.text,
         toolCalls: res.toolCalls,
         providerItems: res.providerItems,
      });

      if (textToolCall) {
         messages.push({ role: 'user', content: TEXT_TOOL_CALL_REPAIR });
         continue;
      }

      if (!res.toolCalls.length) {
         if (i === 1 && !res.text.trim()) {
            return fail('empty_output', 'no tool calls and no text');
         }
         return trace;
      }

      // Valid calls of one turn run in parallel; invalid ones get their error as the result.
      const results = await Promise.all(
         checked.map((c) => ('error' in c ? null : executeCall(c.tool, c.args)))
      );

      checked.forEach((c, idx) => {
         const result = results[idx];
         let content: string;
         if ('error' in c || !result) {
            content = `Error: ${'error' in c ? c.error : 'not executed'} Fix the arguments and call the tool again.`;
         } else {
            trace.steps.push({ step: trace.steps.length + 1, ...result });
            content = toolMessage(result);
         }
         messages.push({
            role: 'tool',
            toolCallId: c.call.id,
            name: c.call.name,
            content,
         });
      });
   }
}

export async function runAgent<N extends string>(
   userInput: string,
   options: AgentOptions<N>
): Promise<AgentRun<N>> {
   const opts: Required<AgentOptions<N>> = {
      chat: (component, req) => llm.chat(component, req),
      systemPrompt: AGENT_SYSTEM_PROMPT,
      ...options,
   };
   const repairs: Repair[] = [];

   const primary = await runAttempt('planner', 1, userInput, opts, repairs);
   if (!primary.failure) {
      return {
         outcome: 'done',
         attempts: [primary],
         repairs,
         steps: primary.steps,
      };
   }

   const escalation = primary.failure;
   console.warn(
      `[agent] escalating to plannerFallback (${escalation.kind}): ${escalation.message}`
   );

   const fallback = await runAttempt(
      'plannerFallback',
      2,
      userInput,
      opts,
      repairs
   );
   if (fallback.failure) {
      console.error(
         `[agent] plannerFallback failed too (${fallback.failure.kind}): ${fallback.failure.message}`
      );
   }

   return {
      outcome: fallback.failure ? 'failed' : 'done',
      attempts: [primary, fallback],
      repairs,
      escalation,
      steps: fallback.steps,
      ...(fallback.failure && { failure: fallback.failure }),
   };
}

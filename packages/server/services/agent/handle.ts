// AGENT=tools request path: agent loop → synthesis (any tool ran, or the agent failed)
// or chat (no tool needed).
import { collectLlmCalls, llm } from '../../llm';
import { llmConfig } from '../../llm/config';
import { AGENT_SYNTHESIS_PROMPT } from '../../prompts/prompts';
import type { HistoryStore } from '../../repositories/history.repository';
import { generalChat } from '../apps/general.app';
import type { RouterTrace, StepTrace } from '../router/types';
import { AGENT_MAX_ITERATIONS } from './config';
import { runAgent, type AgentFailure, type AgentStep } from './loop';
import { TOOLS, type AgentToolName } from './tools';

/** The trace fields a request path fills in; routerService adds timing and totals. */
export type PathTrace = Omit<
   RouterTrace,
   'input' | 'finalAnswer' | 'latencyMs' | 'llmCalls' | 'totals'
>;

async function synthesize(
   userInput: string,
   steps: AgentStep[],
   failure: AgentFailure | undefined
): Promise<string> {
   const stepsJson = JSON.stringify(
      steps.map((s) => ({
         step: s.step,
         tool: s.tool,
         arguments: s.parameters,
         ok: s.ok,
         output: s.output,
      })),
      null,
      2
   );
   // Function replacements: tool output may contain `$` patterns.
   const prompt = AGENT_SYNTHESIS_PROMPT.replace(
      '{{USER_INPUT}}',
      () => userInput
   )
      .replace('{{TOOL_STEPS_JSON}}', () => stepsJson)
      .replace('{{AGENT_ERROR}}', () =>
         failure ? `${failure.kind}: ${failure.message}` : 'none'
      );

   const text = await llm.generate('synthesis', { prompt, temperature: 0.1 });
   return text.trim();
}

function toStepTrace(s: AgentStep<AgentToolName>): StepTrace {
   return {
      step: s.step,
      tool: s.tool,
      parameters: s.parameters,
      output: s.output,
      numericValue: s.numericValue,
      ok: s.ok,
      numericSource: s.numericValue != null ? 'tool' : null,
      latencyMs: s.latencyMs,
      llmCalls: s.llmCalls,
   };
}

export async function handleWithAgent(
   userInput: string,
   conversationId: string,
   history: HistoryStore
): Promise<{ message: string; intent: string; trace: PathTrace }> {
   const { result: run, calls } = await collectLlmCalls(() =>
      runAgent(userInput, { tools: TOOLS, maxIterations: AGENT_MAX_ITERATIONS })
   );

   // A failed agent always goes to synthesis (even with no steps): chat could invent
   // facts for what was a tool question.
   const useSynthesis = run.steps.length > 0 || run.outcome === 'failed';
   const message = useSynthesis
      ? await synthesize(userInput, run.steps, run.failure)
      : (await generalChat(history.get(conversationId), userInput)).message;

   const plannerSource =
      run.attempts.length === 1
         ? 'primary'
         : run.outcome === 'done'
           ? 'fallback'
           : 'failed';

   return {
      message,
      intent: run.steps[0]?.tool ?? 'generalChat',
      trace: {
         agentMode: 'tools',
         plannerSource,
         plannerErrors: run.attempts.flatMap((a) =>
            a.failure
               ? [`${a.component}: ${a.failure.kind}: ${a.failure.message}`]
               : []
         ),
         plannerCalls: calls.filter(
            (c) =>
               c.component === 'planner' || c.component === 'plannerFallback'
         ),
         agent: {
            outcome: run.outcome,
            attempts: run.attempts.map(({ steps, ...a }) => ({
               ...a,
               provider: llmConfig[a.component].provider,
               model: llmConfig[a.component].model,
               tools: steps.map((s) => s.tool),
            })),
            repairs: run.repairs,
            ...(run.escalation && { escalation: run.escalation }),
            ...(run.failure && { failure: run.failure }),
         },
         steps: run.steps.map(toStepTrace),
         answerSource: useSynthesis ? 'synthesis' : 'chat',
      },
   };
}

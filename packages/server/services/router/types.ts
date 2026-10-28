import type { LlmCall } from '../../llm';
import type { Provider } from '../../llm/types';
import type {
   AgentFailure,
   AgentRun,
   AttemptTrace,
   Repair,
} from '../agent/loop';

export type ToolName =
   | 'getWeather'
   | 'calculateMath'
   | 'getExchangeRate'
   | 'analyzeReview'
   | 'getProductInformation';

// ---- Trace (observability only; never feeds back into routing) ----

/** primary attempt / escalated to plannerFallback / both attempts failed. */
export type PlannerSource = 'primary' | 'fallback' | 'failed';

/** synthesis: a tool ran or the agent failed; chat: no tool was needed. */
export type AnswerSource = 'synthesis' | 'chat';

export type StepTrace = {
   step: number;
   tool: ToolName;
   parameters: Record<string, unknown>;
   /** false = the tool ran but could not produce the fact. */
   ok: boolean;
   output: string;
   /** Returned by the tool: the rate (getExchangeRate) or the result (calculateMath). */
   numericValue: number | null;
   latencyMs: number;
   llmCalls: LlmCall[];
};

export type AgentAttemptTrace = Omit<AttemptTrace, 'steps'> & {
   provider: Provider;
   model: string;
   /** Executed tool names, in order (the last attempt's steps are in RouterTrace.steps). */
   tools: string[];
};

export type AgentTrace = {
   outcome: AgentRun['outcome'];
   attempts: AgentAttemptTrace[];
   repairs: Repair[];
   escalation?: AgentFailure;
   failure?: AgentFailure;
};

export type RouterTrace = {
   input: string;
   plannerSource: PlannerSource;
   plannerErrors: string[];
   plannerCalls: LlmCall[];
   agent: AgentTrace;
   steps: StepTrace[];
   answerSource: AnswerSource;
   finalAnswer: string;
   latencyMs: number;
   llmCalls: LlmCall[]; // every call in the request, in order
   totals: {
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null; // null if any call could not be priced
   };
};

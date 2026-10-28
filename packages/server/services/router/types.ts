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
   | 'getProductInformation'
   | 'generalChat';

export type RouterPlanStep = {
   tool: ToolName;
   parameters: Record<string, unknown>;
};

export type RouterPlan = {
   plan: RouterPlanStep[];
   final_answer_synthesis_required: boolean;
};

export type ExecutedStep = {
   step: number;
   tool: ToolName;
   parameters: Record<string, unknown>;
   output: string;
   numericValue: number | null;
};

// ---- Trace (observability only; never feeds back into routing) ----

/**
 * legacy: primary planner / fallback planner / both failed → generalChat.
 * tools: primary attempt / escalated to plannerFallback / both attempts failed.
 */
export type PlannerSource = 'primary' | 'fallback' | 'generalChat' | 'failed';

/** 'output' = parsed from the tool output (legacy); 'tool' = returned by the tool (agent). */
export type NumericSource = 'output' | 'tool';

export type AnswerSource = 'synthesis' | 'lastStep' | 'chat';

export type StepTrace = ExecutedStep & {
   /** Agent only: false = the tool ran but could not produce the fact. */
   ok?: boolean;
   numericSource: NumericSource | null;
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
   agentMode: 'legacy' | 'tools';
   plannerSource: PlannerSource;
   plannerErrors: string[];
   plannerCalls: LlmCall[];
   rawPlan?: RouterPlan; // legacy: planner output
   plan?: RouterPlan; // legacy: after sanitizeRoute
   agent?: AgentTrace; // tools only
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

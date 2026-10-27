import type { LlmCall } from '../../llm';

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

export type PlannerSource = 'primary' | 'fallback' | 'generalChat';

/** 'hardcode' = numericValue came from knownUsdPriceForProduct, not the tool output. */
export type NumericSource = 'output' | 'hardcode';

export type AnswerSource = 'deterministic' | 'synthesis' | 'lastStep';

export type StepTrace = ExecutedStep & {
   numericSource: NumericSource | null;
   latencyMs: number;
   llmCalls: LlmCall[];
};

export type RouterTrace = {
   input: string;
   plannerSource: PlannerSource;
   plannerErrors: string[];
   plannerCalls: LlmCall[];
   rawPlan: RouterPlan; // planner output
   plan: RouterPlan; // after sanitizeRoute
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

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

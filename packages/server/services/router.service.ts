import {
   classifierPrompt,
   classifierPromptLocal,
   ORCHESTRATION_SYNTHESIS_PROMPT,
} from '../prompts/prompts';
import { collectLlmCalls, llm, type LlmCall } from '../llm';

import { getWeather } from './apps/weather.app';
import { calculateMath } from './apps/math.app';
import { getExchangeRate } from './apps/exchange.app';
import { generalChat } from './apps/general.app';
import { analyzeReviewWithSelfCorrection } from './apps/reviewAnalyzer.app';
import { getProductInformation } from './apps/productInformation.app';

import {
   historyRepository,
   type HistoryStore,
} from '../repositories/history.repository';
import { sanitizeRoute, detectCurrencyFromInput } from './router/policy';
import { resolveParameters } from './router/placeholders';
import type {
   AnswerSource,
   ExecutedStep,
   NumericSource,
   PlannerSource,
   RouterPlan,
   RouterTrace,
   StepTrace,
   ToolName,
} from './router/types';

const ALLOWED_TOOLS: readonly ToolName[] = [
   'getWeather',
   'calculateMath',
   'getExchangeRate',
   'analyzeReview',
   'getProductInformation',
   'generalChat',
] as const;

// Stop sequences keep the local planner from rambling past the JSON plan.
const PLANNER_STOP = ['\n\n', '\n##', '\n###', '```', 'INPUT:', 'Rules:'];

function fillTemplate(userInput: string, useLocal = false) {
   const tpl = useLocal ? classifierPromptLocal : classifierPrompt;
   return tpl.replace('{{USER_INPUT}}', userInput);
}

function extractFirstJsonObject(text: string): string {
   let s = text.trim();

   if (s.startsWith('```json')) s = s.replace(/^```json\s*/i, '');
   if (s.startsWith('```')) s = s.replace(/^```\s*/i, '');
   s = s.replace(/\s*```$/, '').trim();

   const start = s.indexOf('{');
   if (start === -1) throw new Error('No JSON object found in model output.');

   let depth = 0;
   let inString = false;
   let escape = false;

   for (let i = start; i < s.length; i++) {
      const ch = s[i];

      if (inString) {
         if (escape) escape = false;
         else if (ch === '\\') escape = true;
         else if (ch === '"') inString = false;
         continue;
      }

      if (ch === '"') {
         inString = true;
         continue;
      }

      if (ch === '{') depth++;
      if (ch === '}') depth--;

      if (depth === 0) return s.slice(start, i + 1);
   }

   throw new Error('Unterminated JSON object in model output.');
}

function parseRoutingPlan(text: string): RouterPlan {
   const jsonText = extractFirstJsonObject(text);
   const obj = JSON.parse(jsonText) as Partial<RouterPlan>;

   const rawPlan = Array.isArray(obj.plan) ? obj.plan : [];
   const plan = rawPlan
      .filter((step) => step && typeof step === 'object')
      .map((step: any) => {
         const tool = ALLOWED_TOOLS.includes(step.tool)
            ? step.tool
            : 'generalChat';
         const parameters =
            step.parameters && typeof step.parameters === 'object'
               ? step.parameters
               : {};

         return { tool, parameters };
      });

   if (!plan.length) {
      throw new Error('Router returned an empty plan.');
   }

   return {
      plan,
      final_answer_synthesis_required: Boolean(
         obj.final_answer_synthesis_required
      ),
   };
}

function fallbackPlan(userInput: string): RouterPlan {
   return {
      plan: [
         {
            tool: 'generalChat',
            parameters: { userInput },
         },
      ],
      final_answer_synthesis_required: false,
   };
}

async function classifyWithPlanner(userInput: string): Promise<RouterPlan> {
   console.time('router:planner');

   try {
      const promptLocal = fillTemplate(userInput, true);
      const localText = await llm.generate('planner', {
         prompt: promptLocal,
         temperature: 0,
         stop: PLANNER_STOP,
      });

      console.log('🔍 RAW PLAN FROM PLANNER:', localText);
      return parseRoutingPlan(localText);
   } finally {
      console.timeEnd('router:planner');
   }
}

async function classifyWithFallback(userInput: string): Promise<RouterPlan> {
   console.time('router:fallback');

   try {
      const prompt = fillTemplate(userInput, false);
      const text = await llm.generate('plannerFallback', {
         prompt,
         temperature: 0,
         responseFormat: { type: 'json_object' },
      });

      console.log('🔍 RAW PLAN FROM FALLBACK PLANNER:', text);
      return parseRoutingPlan(text);
   } finally {
      console.timeEnd('router:fallback');
   }
}

function errorMessage(err: unknown): string {
   return err instanceof Error ? err.message : String(err);
}

async function classify(
   userInput: string
): Promise<{ plan: RouterPlan; source: PlannerSource; errors: string[] }> {
   const errors: string[] = [];

   try {
      return {
         plan: await classifyWithPlanner(userInput),
         source: 'primary',
         errors,
      };
   } catch (err) {
      console.warn('⚠️ Planner failed, falling back to fallback planner:', err);
      errors.push(`primary: ${errorMessage(err)}`);
   }

   try {
      return {
         plan: await classifyWithFallback(userInput),
         source: 'fallback',
         errors,
      };
   } catch (err) {
      console.error('❌ Router fallback failed:', err);
      errors.push(`fallback: ${errorMessage(err)}`);
      return { plan: fallbackPlan(userInput), source: 'generalChat', errors };
   }
}

function formatReviewAnalysisForUser(analysis: {
   summary: string;
   overall_sentiment: string;
   score: number;
   aspects: Array<{ topic: string; sentiment: string; detail: string }>;
}) {
   const lines: string[] = [];
   lines.push('Analyzing Review...');
   lines.push(`Summary: ${analysis.summary}`);
   lines.push(`Overall Sentiment: ${analysis.overall_sentiment}`);
   lines.push(`Score: ${analysis.score}/10`);

   if (analysis.aspects.length) {
      lines.push('');
      lines.push('Detailed Aspects:');
      analysis.aspects.forEach((a, i) => {
         lines.push(` ${i + 1}. ${a.topic} (${a.sentiment}): "${a.detail}"`);
      });
   }

   return lines.join('\n');
}

function extractNumericValue(output: string): number | null {
   const rateMatch = output.match(/rate\s+([0-9]+(?:\.[0-9]+)?)/i);
   if (rateMatch) return Number(rateMatch[1]);

   const allNumbers = output.match(/-?[0-9]+(?:\.[0-9]+)?/g);
   if (!allNumbers?.length) return null;

   const candidate = Number(allNumbers[allNumbers.length - 1]);
   return Number.isFinite(candidate) ? candidate : null;
}

function extractUsdAmount(output: string): number | null {
   const usdMatch = output.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*USD/i);
   if (usdMatch?.[1]) {
      const value = Number(usdMatch[1].replace(/,/g, ''));
      if (Number.isFinite(value)) return value;
   }

   const priceMatch = output.match(/price[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
   if (priceMatch?.[1]) {
      const value = Number(priceMatch[1]);
      if (Number.isFinite(value)) return value;
   }

   return null;
}

async function executeSingleStep(
   step: { tool: ToolName; parameters: Record<string, unknown> },
   params: Record<string, unknown>,
   userInput: string,
   conversationId: string,
   history: HistoryStore
): Promise<{
   output: string;
   numericValue: number | null;
   numericSource?: NumericSource;
}> {
   switch (step.tool) {
      case 'getWeather': {
         const city = String(
            params.city ?? params.location ?? params.place ?? ''
         ).trim();
         if (!city)
            return { output: 'Missing city parameter.', numericValue: null };
         return { output: await getWeather(city), numericValue: null };
      }

      case 'calculateMath': {
         const expression = String(params.expression ?? '').trim();
         if (!expression) {
            return {
               output: 'Missing expression for math calculation.',
               numericValue: null,
            };
         }
         return { output: await calculateMath(expression), numericValue: null };
      }

      case 'getExchangeRate': {
         let code = String(
            params.currencyCode ?? params.from ?? params.currency ?? 'USD'
         ).toUpperCase();
         if (code === 'ILS') {
            code = detectCurrencyFromInput(userInput);
         }
         const output = getExchangeRate(code, userInput);
         const numericValue = extractNumericValue(output);
         return {
            output,
            numericValue,
            numericSource: numericValue != null ? 'output' : undefined,
         };
      }

      case 'analyzeReview': {
         const reviewText = String(params.reviewText ?? userInput).trim();
         if (!reviewText) {
            return {
               output: 'Missing review text for analysis.',
               numericValue: null,
            };
         }

         const analysis = await analyzeReviewWithSelfCorrection(reviewText);
         return {
            output: formatReviewAnalysisForUser(analysis),
            numericValue: null,
         };
      }

      case 'getProductInformation': {
         const productName = String(
            params.product_name ?? params.productName ?? ''
         ).trim();
         const query = String(params.query ?? userInput).trim();

         if (!productName) {
            return {
               output: 'Missing product_name parameter for product lookup.',
               numericValue: null,
            };
         }

         const output = await getProductInformation(productName, query);
         const numericValue = extractUsdAmount(output);
         return {
            output,
            numericValue,
            numericSource: numericValue != null ? 'output' : undefined,
         };
      }

      case 'generalChat':
      default: {
         const text = String(params.userInput ?? userInput);
         const r = await generalChat(history.get(conversationId), text);
         return { output: r.message, numericValue: null };
      }
   }
}

async function synthesizeFinalAnswer(
   userInput: string,
   steps: ExecutedStep[]
): Promise<string> {
   console.time('orchestration:synthesis');

   try {
      const prompt = ORCHESTRATION_SYNTHESIS_PROMPT.replace(
         '{{USER_INPUT}}',
         userInput
      ).replace('{{TOOL_RESULTS_JSON}}', JSON.stringify(steps, null, 2));

      const text = await llm.generate('synthesis', {
         prompt,
         temperature: 0.1,
      });

      return text.trim();
   } finally {
      console.timeEnd('orchestration:synthesis');
   }
}

type PlanOutcome = {
   message: string;
   intent: string;
   plan: RouterPlan;
   steps: StepTrace[];
   answerSource: AnswerSource;
};

async function executePlan(
   route: RouterPlan,
   userInput: string,
   conversationId: string,
   history: HistoryStore
): Promise<PlanOutcome> {
   console.time('orchestration:total');

   const safeRoute = sanitizeRoute(route, userInput);
   // `executed` is exactly what synthesis sees; trace-only fields live in `steps`.
   const executed: ExecutedStep[] = [];
   const steps: StepTrace[] = [];

   try {
      for (const [idx, step] of safeRoute.plan.entries()) {
         const label = `tool:${idx + 1}:${step.tool}`;
         console.time(label);
         const start = performance.now();

         try {
            const resolvedParameters = resolveParameters(
               step.parameters,
               executed
            );

            const { result, calls } = await collectLlmCalls(() =>
               executeSingleStep(
                  step,
                  resolvedParameters,
                  userInput,
                  conversationId,
                  history
               )
            );

            const executedStep: ExecutedStep = {
               step: idx + 1,
               tool: step.tool,
               parameters: resolvedParameters,
               output: result.output,
               numericValue: result.numericValue,
            };
            executed.push(executedStep);
            steps.push({
               ...executedStep,
               numericSource: result.numericSource ?? null,
               latencyMs: performance.now() - start,
               llmCalls: calls,
            });
         } finally {
            console.timeEnd(label);
         }
      }

      const mustSynthesize =
         safeRoute.final_answer_synthesis_required && executed.length >= 1;

      const message = mustSynthesize
         ? await synthesizeFinalAnswer(userInput, executed)
         : (executed[executed.length - 1]?.output ??
           'I could not produce an answer for this request.');

      return {
         message,
         intent: safeRoute.plan[0]?.tool ?? 'generalChat',
         plan: safeRoute,
         steps,
         answerSource: mustSynthesize ? 'synthesis' : 'lastStep',
      };
   } finally {
      console.timeEnd('orchestration:total');
   }
}

function sumTotals(calls: LlmCall[]): RouterTrace['totals'] {
   return {
      inputTokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
      costUsd: calls.some((c) => c.costUsd == null)
         ? null
         : calls.reduce((n, c) => n + (c.costUsd ?? 0), 0),
   };
}

export type HandleOptions = {
   /** Defaults to the persistent history.json store. */
   history?: HistoryStore;
};

export const routerService = {
   async handleUserMessage(
      conversationId: string,
      userInput: string,
      opts: HandleOptions = {}
   ): Promise<{ message: string; intent?: string; trace?: RouterTrace }> {
      console.log('ROUTER SERVICE HIT 🧠', { conversationId, userInput });
      const history: HistoryStore = opts.history ?? historyRepository;

      if (userInput.trim() === '/reset') {
         await history.resetAll();
         return { message: 'בוצע reset ✅ התחלנו שיחה חדשה.' };
      }

      const start = performance.now();
      const { result, calls } = await collectLlmCalls(async () => {
         const planned = await collectLlmCalls(() => classify(userInput));
         const route = planned.result.plan;

         console.log('📊 Planned Route:', JSON.stringify(route, null, 2));

         const out = await executePlan(
            route,
            userInput,
            conversationId,
            history
         );
         return { planned, out };
      });
      const { planned, out } = result;

      const trace: RouterTrace = {
         input: userInput,
         plannerSource: planned.result.source,
         plannerErrors: planned.result.errors,
         plannerCalls: planned.calls,
         rawPlan: planned.result.plan,
         plan: out.plan,
         steps: out.steps,
         answerSource: out.answerSource,
         finalAnswer: out.message,
         latencyMs: performance.now() - start,
         llmCalls: calls,
         totals: sumTotals(calls),
      };

      history.append(conversationId, {
         role: 'user',
         content: userInput,
      });
      history.append(conversationId, {
         role: 'assistant',
         content: out.message,
      });
      await history.save();

      return { message: out.message, intent: out.intent, trace };
   },
};

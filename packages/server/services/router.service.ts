import {
   classifierPrompt,
   classifierPromptLocal,
   ORCHESTRATION_SYNTHESIS_PROMPT,
} from '../prompts/prompts';
import { llm } from '../llm';

import { getWeather } from './apps/weather.app';
import { calculateMath } from './apps/math.app';
import { getExchangeRate } from './apps/exchange.app';
import { generalChat } from './apps/general.app';
import { analyzeReviewWithSelfCorrection } from './apps/reviewAnalyzer.app';
import { getProductInformation } from './apps/productInformation.app';

import { historyRepository } from '../repositories/history.repository';
import {
   sanitizeRoute,
   detectCurrencyFromInput,
   knownUsdPriceForProduct,
} from './router/policy';
import { resolveParameters } from './router/placeholders';
import { buildDeterministicFinanceMessage } from './router/postprocess';
import type { ExecutedStep, RouterPlan, ToolName } from './router/types';

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

async function classify(userInput: string): Promise<RouterPlan> {
   try {
      return await classifyWithPlanner(userInput);
   } catch (err) {
      console.warn('⚠️ Planner failed, falling back to fallback planner:', err);
   }

   try {
      return await classifyWithFallback(userInput);
   } catch (err) {
      console.error('❌ Router fallback failed:', err);
      return fallbackPlan(userInput);
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
   conversationId: string
): Promise<{ output: string; numericValue: number | null }> {
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
         return { output, numericValue: extractNumericValue(output) };
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
         let numericValue = extractUsdAmount(output);
         if (numericValue == null) {
            numericValue = knownUsdPriceForProduct(productName);
         }

         return {
            output,
            numericValue,
         };
      }

      case 'generalChat':
      default: {
         const history = historyRepository.get(conversationId);
         const text = String(params.userInput ?? userInput);
         const r = await generalChat(history, text);
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

async function executePlan(
   route: RouterPlan,
   userInput: string,
   conversationId: string
): Promise<{ message: string; intent: string }> {
   console.time('orchestration:total');

   const safeRoute = sanitizeRoute(route, userInput);
   const executed: ExecutedStep[] = [];

   try {
      for (const [idx, step] of safeRoute.plan.entries()) {
         const label = `tool:${idx + 1}:${step.tool}`;
         console.time(label);

         try {
            const resolvedParameters = resolveParameters(
               step.parameters,
               executed
            );

            const result = await executeSingleStep(
               step,
               resolvedParameters,
               userInput,
               conversationId
            );

            executed.push({
               step: idx + 1,
               tool: step.tool,
               parameters: resolvedParameters,
               output: result.output,
               numericValue: result.numericValue,
            });
         } finally {
            console.timeEnd(label);
         }
      }

      const deterministic = buildDeterministicFinanceMessage(
         userInput,
         executed,
         safeRoute
      );
      if (deterministic) {
         return {
            message: deterministic,
            intent: safeRoute.plan[0]?.tool ?? 'generalChat',
         };
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
      };
   } finally {
      console.timeEnd('orchestration:total');
   }
}

export const routerService = {
   async handleUserMessage(conversationId: string, userInput: string) {
      console.log('ROUTER SERVICE HIT 🧠', { conversationId, userInput });

      if (userInput.trim() === '/reset') {
         await historyRepository.resetAll();
         return { message: 'בוצע reset ✅ התחלנו שיחה חדשה.' };
      }

      const route = await classify(userInput);

      console.log('📊 Planned Route:', JSON.stringify(route, null, 2));

      const out = await executePlan(route, userInput, conversationId);

      historyRepository.append(conversationId, {
         role: 'user',
         content: userInput,
      });
      historyRepository.append(conversationId, {
         role: 'assistant',
         content: out.message,
      });
      await historyRepository.save();

      return { message: out.message, intent: out.intent };
   },
};

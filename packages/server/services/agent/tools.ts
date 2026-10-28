// Agent tools. Each zod schema is the single source of truth for a tool's parameters:
// providers get it as JSON schema, and the agent validates the model's arguments with it.
import { z } from 'zod';
import type { ToolSpec } from '../../llm';
import type { ToolName } from '../router/types';
import { weatherFor } from '../apps/weather.app';
import { exchangeToIls } from '../apps/exchange.app';
import { evaluateExpression, formatResult } from '../apps/math.app';
import {
   analyzeReviewWithSelfCorrection,
   formatReviewAnalysis,
} from '../apps/reviewAnalyzer.app';
import { productInformation } from '../apps/productInformation.app';

/** ok: false = the tool ran but could not produce the fact (synthesis reports it as failed). */
export type ToolResult = {
   ok: boolean;
   output: string;
   numericValue: number | null;
};

export type AgentTool<N extends string = string> = ToolSpec & {
   name: N;
   /** Re-validates with the schema, so it never runs on unchecked arguments. */
   execute(args: unknown): Promise<ToolResult>;
};

export function defineTool<N extends string, S extends z.ZodObject>(def: {
   name: N;
   description: string;
   schema: S;
   execute(args: z.output<S>): Promise<ToolResult>;
}): AgentTool<N> {
   return {
      name: def.name,
      description: def.description,
      schema: def.schema,
      execute: async (args) => def.execute(def.schema.parse(args)),
   };
}

const text = (ok: boolean, output: string): ToolResult => ({
   ok,
   output,
   numericValue: null,
});

export const TOOLS: AgentTool<ToolName>[] = [
   defineTool({
      name: 'getWeather',
      description:
         'Current weather (temperature, conditions, wind) for a city.',
      schema: z.object({
         city: z.string().trim().min(1).describe('City name, e.g. "Tokyo".'),
      }),
      async execute({ city }) {
         const r = await weatherFor(city);
         return text(r.ok, r.text);
      },
   }),

   defineTool({
      name: 'getExchangeRate',
      description:
         'Live exchange rate from a currency to Israeli shekels (ILS). With an amount, also converts that amount to ILS.',
      schema: z.object({
         currencyCode: z
            .string()
            .trim()
            .regex(/^[A-Za-z]{3}$/, 'Expected a 3-letter ISO 4217 code.')
            .describe(
               'ISO 4217 code of the currency to convert from, e.g. "GBP". The target is always ILS.'
            ),
         amount: z
            .number()
            .positive()
            .nullable()
            // Strict OpenAI tools require every field; a local model may still omit it.
            .default(null)
            .describe(
               'Amount in that currency to convert to ILS, as given by the user. null for the rate only.'
            ),
      }),
      async execute({ currencyCode, amount }) {
         const r = await exchangeToIls(currencyCode, amount);
         return { ok: r.ok, output: r.text, numericValue: r.rate };
      },
   }),

   defineTool({
      name: 'calculateMath',
      description:
         'Evaluates an arithmetic expression exactly. Use it for every calculation, e.g. a price times an exchange rate, or a budget minus a cost.',
      schema: z.object({
         expression: z
            .string()
            .superRefine((expr, ctx) => {
               const r = evaluateExpression(expr);
               if (!r.ok) ctx.addIssue({ code: 'custom', message: r.error });
            })
            .describe(
               'Numbers and + - * / ( ) only, e.g. "(120 * 3.5) - 40". Copy numbers exactly from earlier tool results.'
            ),
      }),
      async execute({ expression }) {
         const r = evaluateExpression(expression);
         return r.ok
            ? { ok: true, output: formatResult(r.value), numericValue: r.value }
            : text(false, r.error);
      },
   }),

   defineTool({
      name: 'analyzeReview',
      description:
         'Aspect-based sentiment analysis of a customer review: summary, overall sentiment, score 1-10 and aspects.',
      schema: z.object({
         reviewText: z
            .string()
            .trim()
            .min(1)
            .describe('The review text, verbatim.'),
      }),
      async execute({ reviewText }) {
         const analysis = await analyzeReviewWithSelfCorrection(reviewText);
         return text(true, formatReviewAnalysis(analysis));
      },
   }),

   defineTool({
      name: 'getProductInformation',
      description:
         'Looks up a product in the store knowledge base: specs, battery, prices in USD, promotions, warranty. Answers only from the knowledge base and says when something is not in it.',
      schema: z.object({
         product_name: z
            .string()
            .trim()
            .min(1)
            .describe(
               'Product name as the user wrote it, e.g. "Nimbus Kettle K2".'
            ),
         query: z
            .string()
            .trim()
            .min(1)
            .describe(
               'What to find out about the product, e.g. "price in USD" or "battery life".'
            ),
      }),
      async execute({ product_name, query }) {
         const r = await productInformation(product_name, query);
         return text(r.ok, r.text);
      },
   }),
];

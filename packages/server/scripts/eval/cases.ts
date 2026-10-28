// Golden-set schema (evals/cases.json) and KB price lookup for derived expectations.
import path from 'path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ToolName } from '../../services/router/types';

export const REPO_ROOT = path.resolve(import.meta.dir, '../../../..');

const DATA_DIR = path.resolve(
   process.env.PRODUCT_DATA_DIR || path.join(REPO_ROOT, 'data/products')
);

const TOOL_NAMES = [
   'getWeather',
   'calculateMath',
   'getExchangeRate',
   'analyzeReview',
   'getProductInformation',
   'generalChat',
] as const satisfies readonly ToolName[];

const ToolNameSchema = z.enum(TOOL_NAMES);

export const CATEGORIES = [
   'single-tool',
   'multi-tool',
   'rag',
   'unknown-product',
   'chit-chat',
   'ambiguous',
] as const;

// Key facts: case-insensitive substring match on the resolved step parameter.
const ArgFactsSchema = z.record(z.string(), z.string());

const DerivedSchema = z
   .object({
      kind: z.enum([
         'remaining_ils',
         'missing_ils',
         'total_ils',
         'convert_ils',
      ]),
      budget: z.number().optional(),
      amount: z.number().optional(),
      products: z.array(z.string().min(1)).optional(), // data/products file stems
      tolerance: z.number().positive().optional(), // absolute ILS; default max(1, 0.5% of expected)
   })
   .strict()
   .refine(
      (d) =>
         d.kind === 'convert_ils'
            ? d.amount !== undefined
            : Boolean(d.products?.length) &&
              (d.kind === 'total_ils' || d.budget !== undefined),
      {
         message:
            'convert_ils needs amount; total_ils needs products; remaining/missing need budget + products',
      }
   );

const ExpectSchema = z
   .object({
      tools: z.array(ToolNameSchema),
      // Required tools must also run in this order (as a subsequence). Only where order matters.
      ordered: z.boolean().optional(),
      allow_extra: z.array(ToolNameSchema).optional(),
      args: z
         .partialRecord(
            ToolNameSchema,
            z.union([ArgFactsSchema, z.array(ArgFactsSchema).min(1)])
         )
         .optional(),
      // Every item is required; an inner array is any-of.
      answer_contains: z
         .array(z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]))
         .optional(),
      answer_not_contains: z.array(z.string().min(1)).optional(),
      derived: DerivedSchema.optional(),
   })
   .strict();

const CaseSchema = z
   .object({
      id: z.string().min(1),
      category: z.enum(CATEGORIES),
      tags: z.array(z.string()).optional(),
      input: z.string().min(1),
      expect: ExpectSchema,
      judge: z
         .object({ rubric: z.string().min(1) })
         .strict()
         .optional(),
   })
   .strict();

const CasesFileSchema = z
   .object({ $comment: z.string().optional(), cases: z.array(CaseSchema) })
   .refine((f) => new Set(f.cases.map((c) => c.id)).size === f.cases.length, {
      message: 'case ids must be unique',
   });

export type EvalCase = z.infer<typeof CaseSchema>;
export type Derived = z.infer<typeof DerivedSchema>;

// The one canonical FAQ price line every product doc keeps (checked in phase 2.1).
const CANONICAL_PRICE_LINE =
   /^- (?:Base |Promotional )?[Pp]rice: ([0-9,]+) USD$/gm;

const priceCache = new Map<string, number>();

/** USD price of a product, read from its KB doc. Throws if the doc has no single canonical price line. */
export function kbPriceUsd(stem: string): number {
   const cached = priceCache.get(stem);
   if (cached !== undefined) return cached;

   const file = path.join(DATA_DIR, `${stem}.txt`);
   const text = readFileSync(file, 'utf8');
   const matches = [...text.matchAll(CANONICAL_PRICE_LINE)];
   if (matches.length !== 1 || !matches[0]?.[1]) {
      throw new Error(
         `${file}: expected exactly one canonical price line, found ${matches.length}`
      );
   }

   const price = Number(matches[0][1].replace(/,/g, ''));
   priceCache.set(stem, price);
   return price;
}

export function loadCases(file: string): EvalCase[] {
   const parsed = CasesFileSchema.safeParse(
      JSON.parse(readFileSync(file, 'utf8'))
   );
   if (!parsed.success) {
      throw new Error(`Invalid ${file}:\n${z.prettifyError(parsed.error)}`);
   }

   // Fail fast on derived cases whose products have no usable KB price.
   for (const c of parsed.data.cases) {
      for (const stem of c.expect.derived?.products ?? []) kbPriceUsd(stem);
   }

   return parsed.data.cases;
}

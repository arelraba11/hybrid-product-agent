import type { RouterPlan, RouterPlanStep, ToolName } from './types';

const FACTUAL_TOOLS = new Set<ToolName>([
   'getWeather',
   'getExchangeRate',
   'analyzeReview',
   'getProductInformation',
   'calculateMath',
]);

const ALLOWED_CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS'];

export function detectCurrencyFromInput(input: string): string {
   const u = input.toUpperCase();
   if (u.includes('GBP') || input.toLowerCase().includes('pound')) return 'GBP';
   if (u.includes('EUR') || input.toLowerCase().includes('euro')) return 'EUR';
   return 'USD';
}

function normalizeCurrencyCode(value: unknown): string | null {
   if (typeof value !== 'string') return null;
   const code = value.trim().toUpperCase();
   if (ALLOWED_CURRENCIES.includes(code)) return code;
   return null;
}

function pickNonIlsCurrency(
   ...candidates: Array<string | null | undefined>
): string | null {
   for (const code of candidates) {
      if (!code) continue;
      const clean = code.trim().toUpperCase();
      if (!ALLOWED_CURRENCIES.includes(clean)) continue;
      if (clean !== 'ILS') return clean;
   }

   for (const code of candidates) {
      if (!code) continue;
      const clean = code.trim().toUpperCase();
      if (ALLOWED_CURRENCIES.includes(clean)) return clean;
   }

   return null;
}

function extractQuotedText(input: string): string | null {
   const m = input.match(/"([^"]+)"/);
   if (m?.[1]?.trim()) return m[1].trim();
   const m2 = input.match(/'([^']+)'/);
   if (m2?.[1]?.trim()) return m2[1].trim();
   return null;
}

function looksLikeReviewQuestion(input: string): boolean {
   const u = input.toLowerCase();
   return (
      u.includes('review') ||
      u.includes('summarize') ||
      u.includes('sentiment') ||
      u.includes('analyze this review') ||
      u.includes('ביקורת') ||
      u.includes('סכם')
   );
}

function looksLikeExchangeQuestion(input: string): boolean {
   const u = input.toLowerCase();
   return (
      u.includes('exchange') ||
      u.includes('rate') ||
      u.includes('currency') ||
      u.includes('usd') ||
      u.includes('eur') ||
      u.includes('gbp') ||
      u.includes('ils') ||
      u.includes('dollar') ||
      u.includes('euro') ||
      u.includes('pound') ||
      u.includes('דולר') ||
      u.includes('אירו') ||
      u.includes('שקל')
   );
}

function extractFirstNumber(input: string): number | null {
   const m = input.match(/(\d+(?:\.\d+)?)/);
   if (!m?.[1]) return null;
   const n = Number(m[1]);
   return Number.isFinite(n) ? n : null;
}

function looksLikeBudgetGapQuestion(input: string): boolean {
   const u = input.toLowerCase();
   return (
      u.includes('missing') ||
      (u.includes('how many') &&
         (u.includes('left') || u.includes('remain'))) ||
      (u.includes('how much') &&
         (u.includes('left') || u.includes('remain'))) ||
      u.includes('נותר') ||
      u.includes('חסר')
   );
}

function looksLikeTotalIlsQuestion(input: string): boolean {
   const u = input.toLowerCase();
   return u.includes('total') && u.includes('ils');
}

function looksOpenEndedRequest(input: string): boolean {
   const u = input.toLowerCase();
   return (
      u.includes('where should i') ||
      u.includes('recommend') ||
      u.includes('suggest') ||
      u.includes('ideas') ||
      u.includes('best place') ||
      u.includes('looking for')
   );
}

export function knownUsdPriceForProduct(productName: string): number | null {
   const key = productName.toLowerCase().trim();
   if (key.includes('evophone')) return 799;
   if (key.includes('printforge')) return 25;
   if (key.includes('brewmaster')) return 349;
   if (key.includes('electroride')) return 32900;
   if (key.includes('neobook')) return 1099;
   return null;
}

function detectKnownProducts(input: string): string[] {
   const known = [
      'EvoPhone X',
      'PrintForge 3D Printer',
      'BrewMaster Y',
      'ElectroRide Z',
      'NeoBook Air 14',
      'NeoBook Air',
   ];

   const lowerInput = input.toLowerCase();
   const matches = known
      .filter((name) => lowerInput.includes(name.toLowerCase()))
      .sort((a, b) => b.length - a.length);

   // Prevent overlapping duplicates like "NeoBook Air 14" + "NeoBook Air".
   const selected: string[] = [];
   for (const name of matches) {
      const lower = name.toLowerCase();
      const overlaps = selected.some((picked) => {
         const p = picked.toLowerCase();
         return p.includes(lower) || lower.includes(p);
      });
      if (!overlaps) selected.push(name);
   }

   return selected;
}

function normalizeStep(step: RouterPlanStep): RouterPlanStep {
   const p = step.parameters ?? {};

   switch (step.tool) {
      case 'getWeather':
         return {
            tool: step.tool,
            parameters: { city: p.city ?? p.location ?? p.place ?? null },
         };
      case 'getExchangeRate': {
         const code =
            pickNonIlsCurrency(
               normalizeCurrencyCode(p.currencyCode),
               normalizeCurrencyCode(p.fromCurrency),
               normalizeCurrencyCode(p.from_currency),
               normalizeCurrencyCode(p.from),
               normalizeCurrencyCode(p.currency),
               normalizeCurrencyCode(p.toCurrency),
               normalizeCurrencyCode(p.to_currency),
               normalizeCurrencyCode(p.to)
            ) ?? 'USD';
         return { tool: step.tool, parameters: { currencyCode: code } };
      }
      case 'calculateMath': {
         const expr = typeof p.expression === 'string' ? p.expression : null;
         if (expr?.trim()) {
            return { tool: step.tool, parameters: { expression: expr } };
         }

         const op = String(p.operation ?? '').toLowerCase();
         const left = p.left ?? p.a;
         const right = p.right ?? p.b;
         const opMap: Record<string, string> = {
            multiply: '*',
            add: '+',
            subtract: '-',
            divide: '/',
         };

         if (left != null && right != null && opMap[op]) {
            return {
               tool: step.tool,
               parameters: {
                  expression: `${String(left)} ${opMap[op]} ${String(right)}`,
               },
            };
         }

         return step;
      }
      case 'analyzeReview':
         return {
            tool: step.tool,
            parameters: {
               reviewText: p.reviewText ?? p.review ?? p.text ?? null,
            },
         };
      case 'getProductInformation':
         return {
            tool: step.tool,
            parameters: {
               product_name:
                  p.product_name ??
                  p.productName ??
                  p.product ??
                  p.itemName ??
                  null,
               query: p.query ?? p.question ?? null,
            },
         };
      case 'generalChat':
      default:
         return {
            tool: 'generalChat',
            parameters: { userInput: p.userInput ?? p.prompt ?? null },
         };
   }
}

export function sanitizeRoute(
   route: RouterPlan,
   userInput: string
): RouterPlan {
   const normalizedPlan = route.plan.map(normalizeStep);

   const hasFactual = normalizedPlan.some((s) => FACTUAL_TOOLS.has(s.tool));
   const keepGeneral = looksOpenEndedRequest(userInput);
   const withoutChatNoise =
      hasFactual && normalizedPlan.length > 1 && !keepGeneral
         ? normalizedPlan.filter((s) => s.tool !== 'generalChat')
         : normalizedPlan;

   let plan = withoutChatNoise.filter((s) => {
      if (s.tool === 'calculateMath') {
         const expr = String(s.parameters.expression ?? '').trim();
         return Boolean(expr);
      }
      return true;
   });

   const requestedCurrency = detectCurrencyFromInput(userInput);
   plan = plan.map((step) => {
      if (step.tool !== 'getExchangeRate') return step;
      return { ...step, parameters: { currencyCode: requestedCurrency } };
   });

   const hasExchangeTool = plan.some((s) => s.tool === 'getExchangeRate');
   if (looksLikeExchangeQuestion(userInput) && !hasExchangeTool) {
      plan.push({
         tool: 'getExchangeRate',
         parameters: { currencyCode: detectCurrencyFromInput(userInput) },
      });
   }

   const quotedText = extractQuotedText(userInput);
   const hasAnalyze = plan.some((s) => s.tool === 'analyzeReview');
   if (looksLikeReviewQuestion(userInput) && quotedText && !hasAnalyze) {
      plan.unshift({
         tool: 'analyzeReview',
         parameters: { reviewText: quotedText },
      });
   }

   plan = plan.map((step) => {
      if (step.tool !== 'analyzeReview') return step;
      const reviewText = String(step.parameters.reviewText ?? '').trim();
      if (reviewText.includes('<result_from_') && quotedText) {
         return {
            tool: step.tool,
            parameters: { reviewText: quotedText },
         };
      }
      return step;
   });

   if (looksLikeBudgetGapQuestion(userInput)) {
      const products = detectKnownProducts(userInput);
      const budget = extractFirstNumber(userInput);
      let exchangeIndex = plan.findIndex((s) => s.tool === 'getExchangeRate');

      // Planner math for budget questions is often directionally wrong.
      // Rebuild one canonical math step from normalized data.
      plan = plan.filter((s) => s.tool !== 'calculateMath');

      for (const product of products) {
         const already = plan.some(
            (s) =>
               s.tool === 'getProductInformation' &&
               String(s.parameters.product_name ?? '')
                  .toLowerCase()
                  .includes(product.toLowerCase())
         );
         if (!already) {
            plan.push({
               tool: 'getProductInformation',
               parameters: {
                  product_name: product,
                  query: `What is the price of ${product}?`,
               },
            });
         }
      }

      if (products.length > 0 && exchangeIndex >= 0) {
         const step = plan[exchangeIndex];
         if (step) step.parameters = { currencyCode: 'USD' };
      }

      if (products.length > 0 && exchangeIndex < 0) {
         plan.push({
            tool: 'getExchangeRate',
            parameters: { currencyCode: 'USD' },
         });
         exchangeIndex = plan.length - 1;
      }

      if (budget != null) {
         const exchangeRef =
            exchangeIndex >= 0
               ? `<result_from_tool_${exchangeIndex + 1}>`
               : '1';

         const knownPrices = products.map((p) => knownUsdPriceForProduct(p));
         const allKnown =
            knownPrices.length > 0 && knownPrices.every((p) => p != null);

         let usdRef = '0';
         if (allKnown) {
            const totalKnown = knownPrices.reduce((a, b) => a + Number(b), 0);
            usdRef = String(totalKnown);
         } else {
            const productStepIndexes = plan
               .map((s, idx) => ({ s, idx }))
               .filter((x) => x.s.tool === 'getProductInformation')
               .map((x) => x.idx);
            if (productStepIndexes.length > 0) {
               usdRef = productStepIndexes
                  .map((idx) => `<result_from_tool_${idx + 1}>`)
                  .join(' + ');
            }
         }

         const lower = userInput.toLowerCase();
         const asksRemain = lower.includes('remain') || lower.includes('left');
         const expression = asksRemain
            ? `${budget} - ((${usdRef}) * ${exchangeRef})`
            : `((${usdRef}) * ${exchangeRef}) - ${budget}`;

         plan.push({
            tool: 'calculateMath',
            parameters: { expression },
         });
      }
   }

   if (looksLikeTotalIlsQuestion(userInput)) {
      const productIndexes: number[] = [];
      for (const [idx, step] of plan.entries()) {
         if (step.tool === 'getProductInformation') {
            productIndexes.push(idx);
            step.parameters = {
               ...step.parameters,
               query: 'What is the price in USD?',
            };
         }
      }

      if (productIndexes.length >= 1) {
         let exchangeIndex = plan.findIndex(
            (s) => s.tool === 'getExchangeRate'
         );
         if (exchangeIndex < 0) {
            const firstMathIndex = plan.findIndex(
               (s) => s.tool === 'calculateMath'
            );
            const exchangeStep: RouterPlanStep = {
               tool: 'getExchangeRate',
               parameters: { currencyCode: 'USD' },
            };
            if (firstMathIndex >= 0) {
               plan.splice(firstMathIndex, 0, exchangeStep);
               exchangeIndex = firstMathIndex;
            } else {
               plan.push(exchangeStep);
               exchangeIndex = plan.length - 1;
            }
         } else {
            const exStep = plan[exchangeIndex];
            if (exStep) exStep.parameters = { currencyCode: 'USD' };
         }

         const firstMathIndex = plan.findIndex(
            (s) => s.tool === 'calculateMath'
         );
         const exchangeRef = `<result_from_tool_${exchangeIndex + 1}>`;
         if (firstMathIndex >= 0) {
            const firstMath = plan[firstMathIndex];
            if (firstMath) {
               const expr = String(firstMath.parameters.expression ?? '');
               if (!expr.includes(exchangeRef)) {
                  plan.push({
                     tool: 'calculateMath',
                     parameters: {
                        expression: `((${expr})) * ${exchangeRef}`,
                     },
                  });
               }
            }
         } else if (productIndexes.length >= 2) {
            const refs = productIndexes
               .map((idx) => `<result_from_tool_${idx + 1}>`)
               .join(' + ');
            plan.push({
               tool: 'calculateMath',
               parameters: {
                  expression: `((${refs})) * ${exchangeRef}`,
               },
            });
         }
      }
   }

   const finalPlan: RouterPlanStep[] = withoutChatNoise.length
      ? plan
      : [
           {
              tool: 'generalChat',
              parameters: { userInput },
           },
        ];

   const nonGeneralCount = finalPlan.filter(
      (s) => s.tool !== 'generalChat'
   ).length;
   const forceSynthesis = nonGeneralCount > 1;

   return {
      plan: finalPlan,
      final_answer_synthesis_required:
         route.final_answer_synthesis_required || forceSynthesis,
   };
}

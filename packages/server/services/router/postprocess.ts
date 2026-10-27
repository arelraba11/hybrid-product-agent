import type { ExecutedStep, RouterPlan, ToolName } from './types';

function parseMathResult(output: string): number | null {
   const m = output.match(/result is\s*(-?[0-9]+(?:\.[0-9]+)?)/i);
   if (!m?.[1]) return null;
   const n = Number(m[1]);
   return Number.isFinite(n) ? n : null;
}

function prettyNumber(value: number): string {
   return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function latestNumericByTool(
   steps: ExecutedStep[],
   tool: ToolName
): number | null {
   const found = [...steps]
      .reverse()
      .find((s) => s.tool === tool && s.numericValue != null);
   return found?.numericValue ?? null;
}

function sumNumericByTool(
   steps: ExecutedStep[],
   tool: ToolName
): number | null {
   const values = steps
      .filter((s) => s.tool === tool && s.numericValue != null)
      .map((s) => Number(s.numericValue));

   if (!values.length) return null;
   return values.reduce((a, b) => a + b, 0);
}

function extractFirstNumber(input: string): number | null {
   const m = input.match(/(\d+(?:\.\d+)?)/);
   if (!m?.[1]) return null;
   const n = Number(m[1]);
   return Number.isFinite(n) ? n : null;
}

function looksLikeTotalIlsQuestion(input: string): boolean {
   const u = input.toLowerCase();
   return u.includes('total') && u.includes('ils');
}

function getProductPriceSignals(steps: ExecutedStep[]): {
   knownUsdTotal: number;
   missingProducts: string[];
} {
   const knownUsdTotal = steps
      .filter(
         (s) => s.tool === 'getProductInformation' && s.numericValue != null
      )
      .reduce((acc, s) => acc + Number(s.numericValue), 0);

   const missingSet = new Set<string>();
   for (const step of steps) {
      if (step.tool !== 'getProductInformation' || step.numericValue != null)
         continue;
      const name = String(
         step.parameters.product_name ?? step.parameters.productName ?? ''
      ).trim();
      if (name) missingSet.add(name);
   }

   return { knownUsdTotal, missingProducts: [...missingSet] };
}

function isConversionOnlyFlow(executed: ExecutedStep[]): boolean {
   const tools = new Set(executed.map((s) => s.tool));
   for (const tool of tools) {
      if (!['getExchangeRate', 'calculateMath'].includes(tool)) return false;
   }
   return tools.has('calculateMath') && tools.has('getExchangeRate');
}

export function buildDeterministicFinanceMessage(
   userInput: string,
   executed: ExecutedStep[],
   safeRoute: RouterPlan
): string | null {
   const lastMath = [...executed]
      .reverse()
      .find((s) => s.tool === 'calculateMath');
   const mathValue = lastMath ? parseMathResult(lastMath.output) : null;
   if (mathValue == null) return null;

   const lowerInput = userInput.toLowerCase();

   if (
      lowerInput.includes('convert') &&
      lowerInput.includes('to ils') &&
      isConversionOnlyFlow(executed)
   ) {
      const rate = latestNumericByTool(executed, 'getExchangeRate');
      const amount = extractFirstNumber(userInput);
      if (rate != null && amount != null) {
         return `${prettyNumber(amount)} * ${prettyNumber(rate)} = ${prettyNumber(mathValue)} ILS`;
      }
      return `${prettyNumber(mathValue)} ILS`;
   }

   if (lowerInput.includes('missing') || lowerInput.includes('חסר')) {
      const rate = latestNumericByTool(executed, 'getExchangeRate');
      const price = sumNumericByTool(executed, 'getProductInformation');
      if (mathValue > 0) {
         if (rate != null && price != null) {
            return `Price is ${prettyNumber(price)} USD at rate ${prettyNumber(rate)} ILS/USD, so you are missing ${prettyNumber(mathValue)} ILS.`;
         }
         return `You are missing ${prettyNumber(mathValue)} ILS.`;
      }
      if (rate != null && price != null) {
         return `Price is ${prettyNumber(price)} USD at rate ${prettyNumber(rate)} ILS/USD, so you have ${prettyNumber(Math.abs(mathValue))} ILS remaining.`;
      }
      return `You are not missing funds. You will have ${prettyNumber(Math.abs(mathValue))} ILS remaining.`;
   }

   if (lowerInput.includes('remain') || lowerInput.includes('left')) {
      const rate = latestNumericByTool(executed, 'getExchangeRate');
      const price = sumNumericByTool(executed, 'getProductInformation');
      if (mathValue >= 0) {
         if (rate != null && price != null) {
            return `Price is ${prettyNumber(price)} USD at rate ${prettyNumber(rate)} ILS/USD, so you will have ${prettyNumber(mathValue)} ILS remaining.`;
         }
         return `You will have ${prettyNumber(mathValue)} ILS remaining.`;
      }
      if (rate != null && price != null) {
         return `Price is ${prettyNumber(price)} USD at rate ${prettyNumber(rate)} ILS/USD, so you are short by ${prettyNumber(Math.abs(mathValue))} ILS.`;
      }
      return `You are short by ${prettyNumber(Math.abs(mathValue))} ILS.`;
   }

   if (looksLikeTotalIlsQuestion(userInput)) {
      const rate = latestNumericByTool(executed, 'getExchangeRate');
      const { knownUsdTotal, missingProducts } =
         getProductPriceSignals(executed);

      if (missingProducts.length > 0) {
         if (rate != null && knownUsdTotal > 0) {
            const knownIls = knownUsdTotal * rate;
            return `Known subtotal is ${prettyNumber(knownIls)} ILS (at ${prettyNumber(rate)} ILS/USD). Full total unavailable because price is missing for: ${missingProducts.join(', ')}.`;
         }
         return `Full total unavailable because price is missing for: ${missingProducts.join(', ')}.`;
      }
      return `The total is ${prettyNumber(mathValue)} ILS.`;
   }

   const nonGeneralCount = safeRoute.plan.filter(
      (s) => s.tool !== 'generalChat'
   ).length;
   if (nonGeneralCount <= 1) return null;

   return null;
}

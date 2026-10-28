// services/apps/math.app.ts
// Arithmetic only. The agent passes an expression (calculateMath tool); there is no
// word-problem translation: the model writes the expression from earlier tool results.

export type Evaluation =
   | { ok: true; value: number }
   | { ok: false; error: string };

/** Arithmetic only: a character whitelist, then evaluation; the result must be finite. */
export function evaluateExpression(expression: string): Evaluation {
   const expr = expression.trim();
   if (!expr) return { ok: false, error: 'Empty expression.' };

   const ALLOWED_CHARS = /^[0-9+\-*/().\s]+$/;
   if (!ALLOWED_CHARS.test(expr)) {
      return {
         ok: false,
         error: 'Invalid expression. Use only numbers and + - * / ( ) .',
      };
   }
   if (
      expr.includes('**') ||
      expr.includes('//') ||
      expr.includes('/*') ||
      expr.includes('*/')
   ) {
      return { ok: false, error: 'Invalid expression.' };
   }

   try {
      const result = Function(`"use strict"; return (${expr});`)() as unknown;

      if (typeof result !== 'number' || !Number.isFinite(result)) {
         return { ok: false, error: 'Result is undefined.' };
      }
      return { ok: true, value: result };
   } catch {
      return {
         ok: false,
         error: "I couldn't compute that. Please check the expression.",
      };
   }
}

export function formatResult(value: number): string {
   const pretty = Number.isInteger(value) ? value.toFixed(0) : value.toString();
   return `The result is ${pretty}`;
}

// services/apps/math.app.ts
import { llmClient } from '../../llm/client';
import { mathCoTPrompt } from '../../prompts/prompts';

function isWordProblem(input: string): boolean {
   // Check if input contains Hebrew/English letters (not just numbers and operators)
   const hasLetters = /[א-תa-zA-Z]/.test(input);
   return hasLetters;
}

async function translateWordProblemToExpression(
   wordProblem: string
): Promise<string | null> {
   const prompt = mathCoTPrompt.replace('{{WORD_PROBLEM}}', wordProblem);

   console.log('🧠 Chain of Thought - Translating word problem to expression');
   console.log('📝 Word Problem:', wordProblem);

   try {
      const response = await llmClient.generateText({
         model: 'gpt-4o-mini',
         prompt,
         temperature: 0,
         maxTokens: 50,
      });

      // Extract just the expression (remove any extra text)
      let expression = response.text.trim();
      // Remove markdown if present
      if (expression.startsWith('```')) {
         expression = expression
            .replace(/^```\w*\s*/, '')
            .replace(/\s*```$/, '');
      }
      // Take only the first line (the expression)
      const firstLine = expression.split('\n')[0];
      expression = firstLine ? firstLine.trim() : expression.trim();

      console.log('✅ CoT Result - Expression:', expression);

      return expression || null;
   } catch (error) {
      console.error('❌ CoT Translation Error:', error);
      return null;
   }
}

function calculateExpression(expression: string): string {
   const expr = expression.trim();
   if (!expr) return 'Empty expression.';

   // If you're using the safe Function-based evaluator:
   const ALLOWED_CHARS = /^[0-9+\-*/().\s]+$/;
   if (!ALLOWED_CHARS.test(expr)) {
      return 'Invalid expression. Use only numbers and + - * / ( ) .';
   }
   if (
      expr.includes('**') ||
      expr.includes('//') ||
      expr.includes('/*') ||
      expr.includes('*/')
   ) {
      return 'Invalid expression.';
   }

   try {
      const result = Function(`"use strict"; return (${expr});`)() as unknown;

      if (typeof result !== 'number' || !Number.isFinite(result)) {
         return 'Result is undefined.';
      }

      const pretty = Number.isInteger(result)
         ? result.toFixed(0)
         : result.toString();
      return `The result is ${pretty}`;
   } catch {
      return "I couldn't compute that. Please check the expression.";
   }
}

export async function calculateMath(input: string): Promise<string> {
   const trimmed = input.trim();
   if (!trimmed) return 'Empty input.';

   // Check if it's a word problem
   if (isWordProblem(trimmed)) {
      // Use Chain of Thought to translate word problem to expression
      const expression = await translateWordProblemToExpression(trimmed);
      if (!expression) {
         return "I couldn't translate that word problem into a mathematical expression.";
      }
      // Now calculate the expression
      return calculateExpression(expression);
   } else {
      // Direct mathematical expression
      return calculateExpression(trimmed);
   }
}

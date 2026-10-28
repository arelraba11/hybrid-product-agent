import { afterEach, describe, expect, mock, test } from 'bun:test';
import { z } from 'zod';
import { toOpenAITool } from '../../llm/openai.provider';
import { TOOLS } from './tools';

const realFetch = globalThis.fetch;

function tool(name: string) {
   const t = TOOLS.find((x) => x.name === name);
   if (!t) throw new Error(`no tool ${name}`);
   return t;
}

describe('tool schemas', () => {
   test.each(TOOLS.map((t) => [t.name, t] as const))(
      '%s converts for Ollama and OpenAI (strict)',
      (_name, t) => {
         const ollama = z.toJSONSchema(t.schema) as { type: string };
         expect(ollama.type).toBe('object');

         const openai = toOpenAITool(t);
         expect(openai.strict).toBe(true);
         expect(openai.description).toBeTruthy();
      }
   );

   test('calculateMath accepts arithmetic and rejects anything else', () => {
      const { schema } = tool('calculateMath');
      expect(schema.safeParse({ expression: '(120 * 3.5) - 40' }).success).toBe(
         true
      );
      for (const bad of ['', '2 +', 'price * 3', '2 ** 8', '1 / 0']) {
         expect(schema.safeParse({ expression: bad }).success).toBe(false);
      }
   });

   test('getExchangeRate: 3-letter code, amount defaults to null', () => {
      const { schema } = tool('getExchangeRate');
      expect(schema.parse({ currencyCode: 'gbp' })).toEqual({
         currencyCode: 'gbp',
         amount: null,
      });
      expect(schema.safeParse({ currencyCode: 'dollars' }).success).toBe(false);
      expect(
         schema.safeParse({ currencyCode: 'GBP', amount: -5 }).success
      ).toBe(false);
   });

   test('getProductInformation needs a name and a query', () => {
      const { schema } = tool('getProductInformation');
      expect(schema.safeParse({ product_name: ' ', query: 'x' }).success).toBe(
         false
      );
   });
});

describe('tool execution', () => {
   afterEach(() => {
      globalThis.fetch = realFetch;
   });

   test('calculateMath returns the value as numericValue', async () => {
      expect(
         await tool('calculateMath').execute({ expression: '7 * 6' })
      ).toEqual({ ok: true, output: 'The result is 42', numericValue: 42 });
   });

   test('execute re-validates its arguments', async () => {
      await expect(
         tool('calculateMath').execute({ expression: 'rm -rf' })
      ).rejects.toThrow();
   });

   test('getExchangeRate converts the amount parameter; numericValue is the rate', async () => {
      globalThis.fetch = mock(
         async () =>
            new Response(
               JSON.stringify({ date: '2026-10-28', rates: { ILS: 4.2 } }),
               { status: 200 }
            )
      ) as unknown as typeof fetch;

      // The FX cache is module-wide: NOK is a code no other test uses.
      expect(
         await tool('getExchangeRate').execute({
            currencyCode: 'nok',
            amount: 50,
         })
      ).toEqual({
         ok: true,
         output:
            '50 NOK = 210 ILS (rate 4.2, ECB reference rate of 2026-10-28)',
         numericValue: 4.2,
      });
   });

   test('getExchangeRate: unknown currency is ok: false with no number', async () => {
      globalThis.fetch = mock(
         async () => new Response('{}', { status: 404 })
      ) as unknown as typeof fetch;

      expect(
         await tool('getExchangeRate').execute({
            currencyCode: 'QQQ',
            amount: null,
         })
      ).toEqual({
         ok: false,
         output: "I don't have a rate for QQQ.",
         numericValue: null,
      });
   });
});

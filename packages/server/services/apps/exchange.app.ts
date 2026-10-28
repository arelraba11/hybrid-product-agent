// services/apps/exchange.app.ts
// Live rates to ILS from Frankfurter (ECB reference rates, no API key, updated once per
// ECB working day). Cached per currency; never falls back to a hardcoded rate.
import { z } from 'zod';

const FX_API_URL = 'https://api.frankfurter.dev/v1/latest';
const FRESH_MS = 60 * 60 * 1000; // refetch after 1h
const MAX_STALE_MS = 24 * 60 * 60 * 1000; // serve a cached rate this long if a refetch fails

const timeoutParsed = z.coerce
   .number()
   .int()
   .positive()
   .default(5_000)
   .safeParse(process.env.FX_TIMEOUT_MS || undefined);
if (!timeoutParsed.success) {
   throw new Error(
      `Invalid FX_TIMEOUT_MS: ${z.prettifyError(timeoutParsed.error)}`
   );
}
const FX_TIMEOUT_MS = timeoutParsed.data;

const FrankfurterResponse = z.object({
   date: z.string(),
   rates: z.object({ ILS: z.number().positive() }),
});

type CachedRate = { rate: number; date: string; fetchedAt: number };

const cache = new Map<string, CachedRate>();

class UnknownCurrencyError extends Error {}

async function fetchRate(code: string): Promise<CachedRate> {
   const url = `${FX_API_URL}?base=${encodeURIComponent(code)}&symbols=ILS`;
   const res = await fetch(url, { signal: AbortSignal.timeout(FX_TIMEOUT_MS) });
   if (res.status === 404) throw new UnknownCurrencyError(code);
   if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);

   const body = FrankfurterResponse.parse(await res.json());
   return { rate: body.rates.ILS, date: body.date, fetchedAt: Date.now() };
}

// Fresh cache hit, else fetch; if the fetch fails, a cached rate up to 24h old is served
// (flagged stale). Throws when neither exists.
async function rateToIls(
   code: string
): Promise<CachedRate & { stale: boolean }> {
   const cached = cache.get(code);
   const age = cached ? Date.now() - cached.fetchedAt : Infinity;
   if (cached && age < FRESH_MS) return { ...cached, stale: false };

   try {
      const fresh = await fetchRate(code);
      cache.set(code, fresh);
      return { ...fresh, stale: false };
   } catch (error) {
      if (cached && age < MAX_STALE_MS) {
         console.warn(
            `[fx] ${code}: refresh failed, serving cached rate from ${cached.date}:`,
            error
         );
         return { ...cached, stale: true };
      }
      throw error;
   }
}

function extractAmount(input: string): number | null {
   // Matches: "10$", "$10", "10 USD", "10usd"
   let match = input.match(/(\d+(?:\.\d+)?)\s*\$/);
   if (match) return Number(match[1]);

   match = input.match(/\$\s*(\d+(?:\.\d+)?)/);
   if (match) return Number(match[1]);

   match = input.match(/(\d+(?:\.\d+)?)\s*(USD|EUR|GBP|ILS)\b/i);
   if (match) return Number(match[1]);

   return null;
}

export type ExchangeResult = {
   ok: boolean;
   text: string;
   /** Rate to ILS (1 unit of the currency); null when no rate is available. */
   rate: number | null;
};

/** Rate of `currencyCode` to ILS; with `amount`, also that amount converted. */
export async function exchangeToIls(
   currencyCode: string,
   amount: number | null = null
): Promise<ExchangeResult> {
   const code = currencyCode.trim().toUpperCase();

   if (code === 'ILS') {
      return { ok: true, text: 'ILS is the base currency (1 ILS).', rate: 1 };
   }

   let live: Awaited<ReturnType<typeof rateToIls>>;
   try {
      live = await rateToIls(code);
   } catch (error) {
      if (error instanceof UnknownCurrencyError) {
         return {
            ok: false,
            text: `I don't have a rate for ${code}.`,
            rate: null,
         };
      }
      console.error(`[fx] ${code}: live rate unavailable:`, error);
      return {
         ok: false,
         text: `The live exchange rate for ${code} is unavailable right now. Please try again later.`,
         rate: null,
      };
   }

   // "rate N" must come first: the legacy router parses the rate from it (extractNumericValue).
   const { rate, date, stale } = live;
   const source = `rate ${rate}, ECB reference rate of ${date}${stale ? ', cached: live update unavailable' : ''}`;

   if (amount !== null && Number.isFinite(amount)) {
      const converted = amount * rate;
      const pretty = Number.isInteger(converted)
         ? converted.toFixed(0)
         : converted.toFixed(2);

      return {
         ok: true,
         text: `${amount} ${code} = ${pretty} ILS (${source})`,
         rate,
      };
   }

   return { ok: true, text: `1 ${code} = ${rate} ILS (${source})`, rate };
}

/** Legacy router: the amount is the first "N USD|EUR|GBP|ILS" in the user input. */
export async function getExchangeRate(
   currencyCode: string,
   userInput?: string
): Promise<string> {
   const amount = userInput ? extractAmount(userInput) : null;
   return (await exchangeToIls(currencyCode, amount)).text;
}

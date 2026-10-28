import {
   afterEach,
   beforeEach,
   describe,
   expect,
   mock,
   setSystemTime,
   test,
} from 'bun:test';
import { getExchangeRate } from './exchange.app';

const HOUR = 60 * 60 * 1000;
const realFetch = globalThis.fetch;

function respond(status: number, body: unknown) {
   const fn = mock(async () => new Response(JSON.stringify(body), { status }));
   globalThis.fetch = fn as unknown as typeof fetch;
   return fn;
}

function failNetwork() {
   const fn = mock(async () => {
      throw new TypeError('network down');
   });
   globalThis.fetch = fn as unknown as typeof fetch;
   return fn;
}

// The module cache persists across tests, so each test uses its own currency code.
describe('getExchangeRate (live, Frankfurter)', () => {
   const now = Date.parse('2026-10-28T12:00:00Z');

   beforeEach(() => setSystemTime(new Date(now)));
   afterEach(() => {
      globalThis.fetch = realFetch;
      setSystemTime();
   });

   test('returns the live rate with "rate N" first and the ECB date', async () => {
      respond(200, { date: '2026-10-28', rates: { ILS: 3.1259 } });
      expect(await getExchangeRate('usd', 'Convert 10 USD')).toBe(
         '10 USD = 31.26 ILS (rate 3.1259, ECB reference rate of 2026-10-28)'
      );
   });

   test('serves from cache within 1h, refetches after', async () => {
      const first = respond(200, { date: '2026-10-28', rates: { ILS: 3.48 } });
      await getExchangeRate('EUR');
      setSystemTime(new Date(now + 30 * 60 * 1000));
      await getExchangeRate('EUR');
      expect(first).toHaveBeenCalledTimes(1);

      const second = respond(200, { date: '2026-10-29', rates: { ILS: 3.5 } });
      setSystemTime(new Date(now + HOUR + 1));
      expect(await getExchangeRate('EUR')).toContain('rate 3.5,');
      expect(second).toHaveBeenCalledTimes(1);
   });

   test('serves a stale cached rate up to 24h when the refresh fails, labeled', async () => {
      respond(200, { date: '2026-10-28', rates: { ILS: 4.15 } });
      await getExchangeRate('GBP');

      failNetwork();
      setSystemTime(new Date(now + 5 * HOUR));
      expect(await getExchangeRate('GBP')).toBe(
         '1 GBP = 4.15 ILS (rate 4.15, ECB reference rate of 2026-10-28, cached: live update unavailable)'
      );
   });

   test('errors after 24h without a refresh, never a hardcoded rate', async () => {
      respond(200, { date: '2026-10-28', rates: { ILS: 0.5 } });
      await getExchangeRate('CHF');

      failNetwork();
      setSystemTime(new Date(now + 25 * HOUR));
      const out = await getExchangeRate('CHF');
      expect(out).toBe(
         'The live exchange rate for CHF is unavailable right now. Please try again later.'
      );
      expect(out).not.toMatch(/\d/);
   });

   test('errors with no cache when the API is down or returns a bad shape', async () => {
      failNetwork();
      expect(await getExchangeRate('JPY')).toContain('unavailable right now');
      respond(200, { date: '2026-10-28', rates: {} });
      expect(await getExchangeRate('JPY')).toContain('unavailable right now');
   });

   test('unknown currency (404) is reported as such', async () => {
      respond(404, { message: 'not found' });
      expect(await getExchangeRate('XYZ')).toBe("I don't have a rate for XYZ.");
   });

   test('ILS needs no lookup', async () => {
      const fn = failNetwork();
      expect(await getExchangeRate('ILS')).toBe(
         'ILS is the base currency (1 ILS).'
      );
      expect(fn).not.toHaveBeenCalled();
   });
});

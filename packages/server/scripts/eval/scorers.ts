// Deterministic scorers. The LLM judge lives in scripts/eval.ts (it needs the LLM layer).
import type { RouterTrace, ToolName } from '../../services/router/types';
import { kbPriceUsd, type Derived, type EvalCase } from './cases';

export type ScorerName =
   | 'crash'
   | 'tools'
   | 'args'
   | 'contains'
   | 'not_contains'
   | 'derived'
   | 'judge';

export type Score = { scorer: ScorerName; pass: boolean; detail?: string };

/** Lowercase, straight quotes, thousands separators removed (32,900 -> 32900). */
export function normalizeText(s: string): string {
   return s
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
}

function escapeRegex(s: string) {
   return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Numbers never match inside longer numbers ("25" is not in "250" or "1.25").
// With wordEdges, letters also need word boundaries ("ils" is not in "details").
function needleRegex(needle: string, wordEdges: boolean): RegExp {
   const n = normalizeText(needle);
   const first = n[0] ?? '';
   const last = n[n.length - 1] ?? '';

   let pre = '';
   if (/\d/.test(first)) pre = '(?<![\\d.])';
   else if (wordEdges && /[a-z]/.test(first)) pre = '(?<![a-z0-9])';

   let post = '';
   if (/\d/.test(last)) post = '(?!\\d|\\.\\d)';
   else if (wordEdges && /[a-z]/.test(last)) post = '(?![a-z0-9])';

   return new RegExp(pre + escapeRegex(n) + post);
}

function sameSequence(a: readonly string[], b: readonly string[]) {
   return a.length === b.length && a.every((x, i) => x === b[i]);
}

function fmtTools(tools: readonly string[]) {
   return tools.length ? tools.join(' → ') : '(none)';
}

/** Executed tools, ignoring generalChat (expect.tools: [] means "no tools"). */
export function executedTools(trace: RouterTrace): ToolName[] {
   return trace.steps.map((s) => s.tool).filter((t) => t !== 'generalChat');
}

function scoreTools(c: EvalCase, trace: RouterTrace): Score {
   const expected = c.expect.tools;
   const extra = c.expect.allow_extra ?? [];
   const actual = executedTools(trace);
   const considered = actual.filter(
      (t) => expected.includes(t) || !extra.includes(t)
   );

   const pass = c.expect.ordered
      ? sameSequence(considered, expected)
      : sameSequence([...considered].sort(), [...expected].sort());

   return {
      scorer: 'tools',
      pass,
      detail: pass
         ? undefined
         : `expected ${fmtTools(expected)}${extra.length ? ` (+ optional ${extra.join(', ')})` : ''}, got ${fmtTools(actual)}`,
   };
}

function paramText(value: unknown): string {
   if (value == null) return '';
   return typeof value === 'string' ? value : JSON.stringify(value);
}

function scoreArgs(c: EvalCase, trace: RouterTrace): Score | null {
   const args = c.expect.args;
   if (!args) return null;

   const misses: string[] = [];

   for (const [tool, spec] of Object.entries(args)) {
      if (!spec) continue;
      const wanted = Array.isArray(spec) ? spec : [spec];
      const unused = trace.steps.filter((s) => s.tool === tool);

      // Each expected fact set must match a distinct step of that tool.
      for (const facts of wanted) {
         const idx = unused.findIndex((s) =>
            Object.entries(facts).every(([key, value]) =>
               paramText(s.parameters[key])
                  .toLowerCase()
                  .includes(value.toLowerCase())
            )
         );
         if (idx === -1) misses.push(`${tool} ${JSON.stringify(facts)}`);
         else unused.splice(idx, 1);
      }
   }

   if (!misses.length) return { scorer: 'args', pass: true };

   const seen = trace.steps
      .map((s) => `${s.tool} ${JSON.stringify(s.parameters)}`)
      .join('; ');
   return {
      scorer: 'args',
      pass: false,
      detail: `no step matched ${misses.join(', ')}; steps: ${seen || '(none)'}`,
   };
}

function scoreContains(c: EvalCase, answer: string): Score | null {
   const items = c.expect.answer_contains;
   if (!items) return null;

   const text = normalizeText(answer);
   const missing = items.filter((item) => {
      const options = Array.isArray(item) ? item : [item];
      return !options.some((o) => needleRegex(o, false).test(text));
   });

   return {
      scorer: 'contains',
      pass: !missing.length,
      detail: missing.length
         ? `missing ${missing.map((m) => (Array.isArray(m) ? `(${m.join(' | ')})` : m)).join(', ')}`
         : undefined,
   };
}

function scoreNotContains(c: EvalCase, answer: string): Score | null {
   const items = c.expect.answer_not_contains;
   if (!items) return null;

   const text = normalizeText(answer);
   const found = items.filter((item) => needleRegex(item, true).test(text));

   return {
      scorer: 'not_contains',
      pass: !found.length,
      detail: found.length ? `found ${found.join(', ')}` : undefined,
   };
}

function expectedValue(d: Derived, rate: number, usd: number): number {
   switch (d.kind) {
      case 'remaining_ils':
         return (d.budget ?? 0) - usd * rate;
      case 'missing_ils':
         return usd * rate - (d.budget ?? 0);
      case 'total_ils':
         return usd * rate;
      case 'convert_ils':
         return (d.amount ?? 0) * rate;
   }
}

function round(n: number) {
   return Math.round(n * 100) / 100;
}

// Rate comes from the trace (whatever getExchangeRate returned), prices from the KB,
// so the expectation stays valid when hardcoded rates are replaced in phase 3.
function scoreDerived(c: EvalCase, trace: RouterTrace): Score | null {
   const d = c.expect.derived;
   if (!d) return null;

   const rateStep = [...trace.steps]
      .reverse()
      .find((s) => s.tool === 'getExchangeRate' && s.numericValue != null);
   const rate = rateStep?.numericValue;
   if (rate == null) {
      return {
         scorer: 'derived',
         pass: false,
         detail: 'rate not grounded (no getExchangeRate value in trace)',
      };
   }

   const usd = (d.products ?? []).reduce((sum, p) => sum + kbPriceUsd(p), 0);
   const expected = expectedValue(d, rate, usd);
   const tolerance = d.tolerance ?? 0.01;

   // Sign-insensitive: "short by 583.75" and "-583.75" both count.
   const numbers = (
      normalizeText(trace.finalAnswer).match(/\d+(?:\.\d+)?/g) ?? []
   )
      .map(Number)
      .filter(Number.isFinite);
   const pass = numbers.some(
      (n) => Math.abs(n - Math.abs(expected)) <= tolerance
   );

   return {
      scorer: 'derived',
      pass,
      detail: pass
         ? undefined
         : `expected ≈ ${round(expected)} (rate ${rate}, ${usd} USD); answer numbers: ${numbers.slice(0, 8).join(', ') || '(none)'}`,
   };
}

export function scoreDeterministic(c: EvalCase, trace: RouterTrace): Score[] {
   return [
      scoreTools(c, trace),
      scoreArgs(c, trace),
      scoreContains(c, trace.finalAnswer),
      scoreNotContains(c, trace.finalAnswer),
      scoreDerived(c, trace),
   ].filter((s): s is Score => s !== null);
}

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
   | 'grounded_numbers'
   | 'judge';

/** informational: reported, but doesn't decide whether the run passes (measurement only). */
export type Score = {
   scorer: ScorerName;
   pass: boolean;
   detail?: string;
   informational?: boolean;
};

/** A run passes when every non-informational score passes. */
export function runPasses(scores: Score[]): boolean {
   return scores.every((s) => s.pass || s.informational);
}

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

function fmtTools(tools: readonly string[]) {
   return tools.length ? tools.join(' → ') : '(none)';
}

/** Executed tools, in order (expect.tools: [] means "no tools"). */
export function executedTools(trace: RouterTrace): ToolName[] {
   return trace.steps.map((s) => s.tool);
}

function countTools(tools: readonly string[]): Map<string, number> {
   const counts = new Map<string, number>();
   for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1);
   return counts;
}

/** `needle` appears in `haystack` in order, not necessarily contiguously. */
function isSubsequence(needle: readonly string[], haystack: readonly string[]) {
   let i = 0;
   for (const t of haystack) if (t === needle[i]) i++;
   return i === needle.length;
}

// Required tools must all run (at least as often as listed); repeats and other tools in
// allow_extra are fine, any other tool fails. Several valid paths exist (two-step math,
// converting via getExchangeRate's amount), so correctness is left to derived/contains/judge.
function scoreTools(c: EvalCase, trace: RouterTrace): Score {
   const expected = c.expect.tools;
   const extra = c.expect.allow_extra ?? [];
   const actual = executedTools(trace);
   const got = countTools(actual);

   const problems: string[] = [];
   for (const [tool, need] of countTools(expected)) {
      const n = got.get(tool) ?? 0;
      if (n < need) problems.push(`missing ${tool} (${n}/${need})`);
   }
   const unexpected = [...got.keys()].filter(
      (t) => !expected.includes(t as ToolName) && !extra.includes(t as ToolName)
   );
   if (unexpected.length) problems.push(`unexpected ${unexpected.join(', ')}`);
   if (c.expect.ordered && !isSubsequence(expected, actual)) {
      problems.push('out of order');
   }

   return {
      scorer: 'tools',
      pass: !problems.length,
      detail: problems.length
         ? `${problems.join('; ')}: expected ${fmtTools(expected)}${extra.length ? ` (+ optional ${extra.join(', ')})` : ''}, got ${fmtTools(actual)}`
         : undefined,
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
   // Synthesis rounds money ("about 2,154 ILS"), so the default is relative:
   // max(1 ILS, 0.5% of the expected value). A case's `tolerance` overrides it (absolute).
   const tolerance = d.tolerance ?? Math.max(1, Math.abs(expected) * 0.005);

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

function decimals(token: string): number {
   return token.split('.')[1]?.length ?? 0;
}

// "2,498" grounds 2497.5941 (rounded to the answer's precision); signs are ignored
// ("missing 2.41" vs -2.41).
function grounds(source: number, token: string): boolean {
   const n = Number(token);
   const f = 10 ** decimals(token);
   return Math.abs(Math.round(Math.abs(source) * f) / f - n) < 1e-9;
}

/**
 * Every number in the answer must appear in a tool output or the user input, allowing
 * rounding. Applies only when tools ran (not to chat answers). Measurement only for now.
 */
function scoreGroundedNumbers(trace: RouterTrace): Score | null {
   const outputs = trace.steps.map((s) => s.output);
   if (!outputs.length) return null;

   const numbersIn = (text: string) =>
      normalizeText(text).match(/\d+(?:\.\d+)?/g) ?? [];
   const sources = [trace.input, ...outputs].flatMap(numbersIn).map(Number);
   // Markdown list markers ("1. ") are formatting, not facts.
   const answer = trace.finalAnswer.replace(/^\s*\d+[.)]\s/gm, '');
   const ungrounded = [
      ...new Set(
         numbersIn(answer).filter((t) => !sources.some((m) => grounds(m, t)))
      ),
   ];

   return {
      scorer: 'grounded_numbers',
      pass: !ungrounded.length,
      informational: true,
      detail: ungrounded.length
         ? `not in any tool output or the input: ${ungrounded.join(', ')}`
         : undefined,
   };
}

export function scoreDeterministic(c: EvalCase, trace: RouterTrace): Score[] {
   return [
      scoreTools(c, trace),
      scoreArgs(c, trace),
      scoreContains(c, trace.finalAnswer),
      scoreNotContains(c, trace.finalAnswer),
      scoreDerived(c, trace),
      scoreGroundedNumbers(trace),
   ].filter((s): s is Score => s !== null);
}

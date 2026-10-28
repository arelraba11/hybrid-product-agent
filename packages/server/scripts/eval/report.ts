// Summary statistics and console tables for an eval run.
import type { LlmCall } from '../../llm';
import type { RouterTrace } from '../../services/router/types';
import type { EvalCase } from './cases';
import type { Score, ScorerName } from './scorers';

export type RunRecord = {
   run: number;
   pass: boolean;
   scores: Score[];
   error?: string;
   trace?: RouterTrace;
   judgeCalls: LlmCall[];
};

export type CaseResult = {
   id: string;
   category: EvalCase['category'];
   tags: string[];
   input: string;
   runs: RunRecord[];
};

type Rate = { runs: number; passes: number; passRate: number };

export type Summary = {
   cases: number;
   runs: number;
   overall: Rate;
   byCategory: Record<string, Rate>;
   byTag: Record<string, Rate>;
   byScorer: Partial<Record<ScorerName, Rate>>;
   latencyMs: { p50: number | null; p95: number | null };
   tokens: { input: number; output: number };
   costUsd: { router: number | null; judge: number | null };
   fallbackRate: number; // plannerSource !== 'primary' (tools: escalation rate)
   plannerFailedRate: number; // both planners/attempts failed
   /** AGENT=tools runs only. */
   agent: AgentSummary | null;
   crashes: number;
};

type AgentSummary = {
   runs: number;
   repairRate: number; // runs with a repair
   escalationRate: number; // runs that escalated to plannerFallback
   escalationReasons: Record<string, number>; // by failure kind
   failedRate: number; // both attempts failed
   meanIterations: number; // model turns per run, all attempts
   invalidCallRate: number; // tool calls that failed validation / all tool calls
   textToolCallRate: number; // runs with a tool call written as text
   chatAnswerRate: number; // runs answered by chat (no tool ran)
};

function summarizeAgent(traces: RouterTrace[]): AgentSummary | null {
   const agents = traces.flatMap((t) => (t.agent ? [t] : []));
   if (!agents.length) return null;
   const n = agents.length;

   const iterations = agents.flatMap((t) =>
      t.agent!.attempts.flatMap((a) => a.iterations)
   );
   const calls = iterations.flatMap((it) => it.toolCalls);
   const escalationReasons: Record<string, number> = {};
   for (const t of agents) {
      const kind = t.agent!.escalation?.kind;
      if (kind) escalationReasons[kind] = (escalationReasons[kind] ?? 0) + 1;
   }

   return {
      runs: n,
      repairRate: agents.filter((t) => t.agent!.repairs.length).length / n,
      escalationRate: agents.filter((t) => t.agent!.escalation).length / n,
      escalationReasons,
      failedRate:
         agents.filter((t) => t.agent!.outcome === 'failed').length / n,
      meanIterations: iterations.length / n,
      invalidCallRate: calls.length
         ? calls.filter((c) => c.error).length / calls.length
         : 0,
      textToolCallRate:
         agents.filter((t) =>
            t.agent!.attempts.some((a) =>
               a.iterations.some((it) => it.textToolCall)
            )
         ).length / n,
      chatAnswerRate:
         agents.filter((t) => t.answerSource === 'chat').length / n,
   };
}

function rate(runs: number, passes: number): Rate {
   return { runs, passes, passRate: runs ? passes / runs : 0 };
}

function addTo(map: Record<string, Rate>, key: string, pass: boolean) {
   const r = map[key] ?? rate(0, 0);
   map[key] = rate(r.runs + 1, r.passes + (pass ? 1 : 0));
}

// Nearest-rank percentile.
function percentile(sorted: number[], p: number): number | null {
   if (!sorted.length) return null;
   const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
   return sorted[Math.max(0, idx)] ?? null;
}

function sumCost(calls: LlmCall[]): number | null {
   if (calls.some((c) => c.costUsd == null)) return null;
   return calls.reduce((n, c) => n + (c.costUsd ?? 0), 0);
}

export function summarize(results: CaseResult[]): Summary {
   const runs = results.flatMap((r) => r.runs.map((run) => ({ c: r, run })));
   const traces = runs.flatMap(({ run }) => (run.trace ? [run.trace] : []));
   const fraction = (n: number) => (runs.length ? n / runs.length : 0);

   const byCategory: Record<string, Rate> = {};
   const byTag: Record<string, Rate> = {};
   const byScorer: Record<string, Rate> = {};

   for (const { c, run } of runs) {
      addTo(byCategory, c.category, run.pass);
      for (const tag of c.tags) addTo(byTag, tag, run.pass);
      for (const s of run.scores) addTo(byScorer, s.scorer, s.pass);
   }

   const latencies = traces.map((t) => t.latencyMs).sort((a, b) => a - b);
   const routerCalls = traces.flatMap((t) => t.llmCalls);
   const judgeCalls = runs.flatMap(({ run }) => run.judgeCalls);

   return {
      cases: results.length,
      runs: runs.length,
      overall: rate(runs.length, runs.filter(({ run }) => run.pass).length),
      byCategory,
      byTag,
      byScorer,
      latencyMs: {
         p50: percentile(latencies, 0.5),
         p95: percentile(latencies, 0.95),
      },
      tokens: {
         input: routerCalls.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
         output: routerCalls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
      },
      costUsd: { router: sumCost(routerCalls), judge: sumCost(judgeCalls) },
      fallbackRate: fraction(
         traces.filter((t) => t.plannerSource !== 'primary').length
      ),
      plannerFailedRate: fraction(
         traces.filter(
            (t) =>
               t.plannerSource === 'generalChat' || t.plannerSource === 'failed'
         ).length
      ),
      agent: summarizeAgent(traces),
      crashes: runs.filter(({ run }) => run.error !== undefined).length,
   };
}

// ---- console output ----

function pct(n: number) {
   return `${(n * 100).toFixed(0)}%`;
}

function secs(ms: number | null) {
   return ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`;
}

function usd(n: number | null) {
   return n == null ? 'n/a (unpriced model)' : `$${n.toFixed(4)}`;
}

function table(header: string[], rows: string[][]): string {
   const widths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
   );
   const line = (cells: string[]) =>
      cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ');
   return [
      line(header),
      widths.map((w) => '-'.repeat(w)).join('  '),
      ...rows.map(line),
   ].join('\n');
}

function failureCounts(runs: RunRecord[]): string {
   const counts = new Map<string, number>();
   for (const run of runs) {
      for (const s of run.scores) {
         if (!s.pass && !s.informational) {
            counts.set(s.scorer, (counts.get(s.scorer) ?? 0) + 1);
         }
      }
   }
   return [...counts].map(([k, n]) => `${k}×${n}`).join(' ');
}

/** Passes/applicable runs of a measurement-only scorer; '-' when it never applied. */
function informationalRate(runs: RunRecord[], scorer: ScorerName): string {
   const scores = runs.flatMap((run) =>
      run.scores.filter((s) => s.scorer === scorer)
   );
   if (!scores.length) return '-';
   return `${scores.filter((s) => s.pass).length}/${scores.length}`;
}

function rateRows(map: Record<string, Rate>): string[][] {
   return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, r]) => [k, `${r.passes}/${r.runs}`, pct(r.passRate)]);
}

function agentRows(a: AgentSummary): string[][] {
   const reasons = Object.entries(a.escalationReasons)
      .map(([k, n]) => `${k}×${n}`)
      .join(' ');
   return [
      ['agent: repair rate', pct(a.repairRate)],
      [
         'agent: escalation rate',
         `${pct(a.escalationRate)}${reasons ? ` (${reasons})` : ''}`,
      ],
      ['agent: both attempts failed', pct(a.failedRate)],
      ['agent: mean iterations', a.meanIterations.toFixed(2)],
      ['agent: invalid tool calls', pct(a.invalidCallRate)],
      ['agent: tool call as text', pct(a.textToolCallRate)],
      ['agent: chat answers', pct(a.chatAnswerRate)],
   ];
}

export function formatReport(results: CaseResult[], summary: Summary): string {
   const caseRows = results.map((r) => {
      const passes = r.runs.filter((run) => run.pass).length;
      const lat = r.runs
         .flatMap((run) => (run.trace ? [run.trace.latencyMs] : []))
         .sort((a, b) => a - b);
      return [
         r.id,
         r.category,
         `${passes}/${r.runs.length}`,
         secs(percentile(lat, 0.5)),
         informationalRate(r.runs, 'grounded_numbers'),
         failureCounts(r.runs),
      ];
   });

   const s = summary;
   const totals = [
      [
         'overall',
         `${s.overall.passes}/${s.overall.runs}`,
         pct(s.overall.passRate),
      ],
   ];

   return [
      table(
         ['case', 'category', 'pass', 'p50', 'grounded', 'failures'],
         caseRows
      ),
      '',
      table(
         ['category', 'pass', 'rate'],
         [...rateRows(s.byCategory), ...totals]
      ),
      '',
      table(['tag', 'pass', 'rate'], rateRows(s.byTag)),
      '',
      table(
         ['scorer', 'pass', 'rate'],
         rateRows(s.byScorer as Record<string, Rate>)
      ),
      '',
      table(
         ['metric', 'value'],
         [
            [
               'latency p50 / p95',
               `${secs(s.latencyMs.p50)} / ${secs(s.latencyMs.p95)}`,
            ],
            ['tokens in / out', `${s.tokens.input} / ${s.tokens.output}`],
            ['cost router', usd(s.costUsd.router)],
            ['cost judge', usd(s.costUsd.judge)],
            ['fallback rate', pct(s.fallbackRate)],
            ['both planners failed', pct(s.plannerFailedRate)],
            ['crashes', String(s.crashes)],
            ...(s.agent ? agentRows(s.agent) : []),
         ]
      ),
   ].join('\n');
}

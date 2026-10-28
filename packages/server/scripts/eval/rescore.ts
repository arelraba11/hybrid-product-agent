// Re-scores a saved results file with the current deterministic scorers and cases.json,
// offline (no LLM calls): judge verdicts and crashed runs are kept as recorded.
import path from 'path';
import { readFileSync, writeFileSync } from 'node:fs';
import type { RouterTrace } from '../../services/router/types';
import { REPO_ROOT, loadCases } from './cases';
import {
   formatReport,
   summarize,
   type CaseResult,
   type RunRecord,
} from './report';
import { runPasses, scoreDeterministic } from './scorers';

type ResultsFile = {
   meta: Record<string, unknown>;
   results: CaseResult[];
};

export function rescore(file: string): void {
   const data = JSON.parse(readFileSync(file, 'utf8')) as ResultsFile;
   const cases = new Map(
      loadCases(path.join(REPO_ROOT, 'evals/cases.json')).map((c) => [c.id, c])
   );

   const results: CaseResult[] = data.results.map((r) => {
      const c = cases.get(r.id);
      if (!c) throw new Error(`case ${r.id} is no longer in cases.json`);

      return {
         ...r,
         runs: r.runs.map((run): RunRecord => {
            const trace: RouterTrace | undefined = run.trace;
            if (!trace) return run; // crashed: nothing to re-score
            const scores = [
               ...scoreDeterministic(c, trace),
               ...run.scores.filter((s) => s.scorer === 'judge'),
            ];
            return { ...run, scores, pass: runPasses(scores) };
         }),
      };
   });

   const summary = summarize(results);
   console.log(
      `Rescored ${path.relative(REPO_ROOT, file)} (${String(data.meta.config)}, ${String(data.meta.gitSha)})\n`
   );
   console.log(formatReport(results, summary));

   const out = file.replace(/\.json$/, '-rescored.json');
   writeFileSync(
      out,
      JSON.stringify(
         {
            meta: { ...data.meta, rescoredAt: new Date().toISOString() },
            summary,
            results,
         },
         null,
         2
      )
   );
   console.log(`\nRescored results: ${path.relative(REPO_ROOT, out)}`);
}

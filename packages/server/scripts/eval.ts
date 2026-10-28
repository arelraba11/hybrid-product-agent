// Eval runner. From the repo root:
//   bun run eval --config evals/configs/openai-only.env --runs 3 [--filter <id|category|tag>] [--verbose]
//   bun run eval --rescore evals/results/<file>.json   (re-score saved traces offline, no LLM calls)
// Runs every case in-process through routerService with an isolated in-memory history,
// scores it, prints a summary and writes raw results (with traces) to evals/results/.
import path from 'path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { z } from 'zod';
import { COMPONENTS } from '../llm/types';
import { REPO_ROOT, loadCases, type EvalCase } from './eval/cases';
import { runPasses, scoreDeterministic, type Score } from './eval/scorers';
import { rescore } from './eval/rescore';
import {
   formatReport,
   summarize,
   type CaseResult,
   type RunRecord,
} from './eval/report';

const { values: args } = parseArgs({
   options: {
      config: { type: 'string' },
      runs: { type: 'string', default: '1' },
      filter: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      rescore: { type: 'string' },
   },
});

if (args.rescore) {
   rescore(path.resolve(REPO_ROOT, args.rescore));
   process.exit(0);
}

if (!args.config) {
   console.error(
      'Usage: bun run eval --config evals/configs/<name>.env [--runs N] [--filter id|category|tag] [--verbose]\n       bun run eval --rescore evals/results/<file>.json'
   );
   process.exit(1);
}

const runsPerCase = Number(args.runs);
if (!Number.isInteger(runsPerCase) || runsPerCase < 1) {
   console.error(`--runs must be a positive integer (got ${args.runs})`);
   process.exit(1);
}

const fromRoot = (p: string) =>
   path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
const configPath = fromRoot(args.config);

// Same prefixes as ENV_PREFIX in llm/config.ts (plannerFallback -> PLANNER_FALLBACK).
const envPrefix = (component: string) =>
   component.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase();
const COMPONENT_SUFFIXES = [
   'PROVIDER',
   'MODEL',
   'MAX_TOKENS',
   'REASONING_EFFORT',
   'THINK',
];

/**
 * Overlay the config file on process.env. Component settings inherited from
 * packages/server/.env are cleared first so every run is fully described by its config.
 */
function applyConfig(file: string): Record<string, string> {
   const vars = dotenv.parse(readFileSync(file, 'utf8'));
   const prefixes = COMPONENTS.map(envPrefix);

   const missing = prefixes
      .flatMap((p) => [`${p}_PROVIDER`, `${p}_MODEL`])
      .filter((k) => !vars[k]);
   if (missing.length) {
      throw new Error(
         `${file} must set every component; missing ${missing.join(', ')}`
      );
   }

   // Blank, not delete: importing the Prisma client re-loads packages/server/.env and would
   // refill deleted keys (it never overrides existing ones). llm/config treats '' as unset.
   for (const p of prefixes) {
      for (const suffix of COMPONENT_SUFFIXES)
         process.env[`${p}_${suffix}`] = '';
   }
   Object.assign(process.env, vars);
   return vars;
}

const configVars = applyConfig(configPath);

// Imported only now: llm/config reads process.env at import time.
const { routerService } = await import('../services/router.service');
const { createInMemoryHistory } =
   await import('../repositories/history.repository');
const { llm, collectLlmCalls } = await import('../llm');
const { describeLlmConfig } = await import('../llm/config');
const { EVAL_JUDGE_PROMPT } = await import('../prompts/prompts');

const print = console.log.bind(console);
if (!args.verbose) {
   const mute = () => {};
   console.log = mute;
   console.info = mute;
   console.warn = mute;
   console.error = mute;
   console.time = mute;
   console.timeEnd = mute;
}

const JudgeVerdictSchema = z.object({ pass: z.boolean(), reason: z.string() });

async function judge(c: EvalCase, rubric: string, answer: string) {
   const prompt = EVAL_JUDGE_PROMPT.replace('{{RUBRIC}}', () => rubric)
      .replace('{{USER_INPUT}}', () => c.input)
      .replace('{{ANSWER}}', () => answer);

   try {
      const { result, calls } = await collectLlmCalls(() =>
         llm.generateObject('judge', JudgeVerdictSchema, 'judge_verdict', {
            prompt,
            temperature: 0,
         })
      );
      const score: Score = {
         scorer: 'judge',
         pass: result.data.pass,
         detail: result.data.reason,
      };
      return { score, calls };
   } catch (err) {
      const score: Score = {
         scorer: 'judge',
         pass: false,
         detail: `judge error: ${err instanceof Error ? err.message : String(err)}`,
      };
      return { score, calls: [] };
   }
}

async function runCase(c: EvalCase, run: number): Promise<RunRecord> {
   try {
      const out = await routerService.handleUserMessage(
         crypto.randomUUID(),
         c.input,
         { history: createInMemoryHistory() }
      );
      const trace = out.trace;
      if (!trace) throw new Error('router returned no trace');

      const scores = scoreDeterministic(c, trace);
      let judgeCalls: RunRecord['judgeCalls'] = [];
      if (c.judge) {
         const verdict = await judge(c, c.judge.rubric, trace.finalAnswer);
         scores.push(verdict.score);
         judgeCalls = verdict.calls;
      }

      return {
         run,
         pass: runPasses(scores),
         scores,
         trace,
         judgeCalls,
      };
   } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
         run,
         pass: false,
         scores: [{ scorer: 'crash', pass: false, detail: error }],
         error,
         judgeCalls: [],
      };
   }
}

const filter = args.filter;
const cases = loadCases(path.join(REPO_ROOT, 'evals/cases.json')).filter(
   (c) =>
      !filter ||
      c.id === filter ||
      c.category === filter ||
      (c.tags ?? []).includes(filter)
);
if (!cases.length) {
   print(`No cases match --filter ${filter}`);
   process.exit(1);
}

const gitSha = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], {
   cwd: REPO_ROOT,
})
   .stdout.toString()
   .trim();
const configName = path.basename(configPath).replace(/\.env$/, '');
const startedAt = new Date();

print(
   `Eval: ${cases.length} cases × ${runsPerCase} runs, config ${configName} (${gitSha})`
);
print(`LLM components:\n${describeLlmConfig()}\n`);

const results: CaseResult[] = [];
const total = cases.length * runsPerCase;
let done = 0;

for (const c of cases) {
   const result: CaseResult = {
      id: c.id,
      category: c.category,
      tags: c.tags ?? [],
      input: c.input,
      runs: [],
   };

   for (let run = 1; run <= runsPerCase; run++) {
      const record = await runCase(c, run);
      result.runs.push(record);
      done++;

      const failed = record.scores.filter((s) => !s.pass);
      const latency = record.trace
         ? `${(record.trace.latencyMs / 1000).toFixed(1)}s`
         : '';
      print(
         `[${done}/${total}] ${c.id} #${run} ${record.pass ? 'PASS' : 'FAIL'} ${latency}` +
            failed.map((s) => `\n      ${s.scorer}: ${s.detail ?? ''}`).join('')
      );
   }

   results.push(result);
}

const summary = summarize(results);
print(`\n${formatReport(results, summary)}`);

const stamp = startedAt.toISOString().replace(/[:T]/g, '-').slice(0, 19);
const outDir = path.join(REPO_ROOT, 'evals/results');
const outFile = path.join(outDir, `${stamp}-${configName}.json`);
mkdirSync(outDir, { recursive: true });
writeFileSync(
   outFile,
   JSON.stringify(
      {
         meta: {
            startedAt: startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            gitSha,
            config: path.relative(REPO_ROOT, configPath),
            configVars,
            runsPerCase,
            filter: filter ?? null,
         },
         summary,
         results,
      },
      null,
      2
   )
);
print(`\nRaw results: ${path.relative(REPO_ROOT, outFile)}`);

// Prisma keeps the event loop alive.
process.exit(0);

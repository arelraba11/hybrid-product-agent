import { describe, expect, test } from 'bun:test';
import type {
   RouterTrace,
   StepTrace,
   ToolName,
} from '../../services/router/types';
import type { EvalCase } from './cases';
import { runPasses, scoreDeterministic, type Score } from './scorers';

function step(tool: ToolName, output = ''): StepTrace {
   return {
      step: 0,
      tool,
      parameters: {},
      output,
      numericValue: null,
      numericSource: null,
      latencyMs: 0,
      llmCalls: [],
   };
}

function trace(
   steps: StepTrace[],
   finalAnswer = '',
   input = 'question'
): RouterTrace {
   return {
      input,
      agentMode: 'tools',
      plannerSource: 'primary',
      plannerErrors: [],
      plannerCalls: [],
      steps,
      answerSource: 'synthesis',
      finalAnswer,
      latencyMs: 0,
      llmCalls: [],
      totals: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
   };
}

function evalCase(expect: Partial<EvalCase['expect']>): EvalCase {
   return {
      id: 'c',
      category: 'multi-tool',
      input: 'question',
      expect: { tools: [], ...expect },
   };
}

const score = (scores: Score[], name: Score['scorer']) =>
   scores.find((s) => s.scorer === name);

describe('tools scorer', () => {
   const budget = evalCase({
      tools: ['getProductInformation', 'getExchangeRate', 'calculateMath'],
   });

   test('repeats of required tools pass (two-step math)', () => {
      const t = trace(
         [
            'getProductInformation',
            'getExchangeRate',
            'calculateMath',
            'calculateMath',
         ].map((n) => step(n as ToolName))
      );
      expect(score(scoreDeterministic(budget, t), 'tools')?.pass).toBe(true);
   });

   test('a missing required tool fails, with counts', () => {
      const twoProducts = evalCase({
         tools: [
            'getProductInformation',
            'getProductInformation',
            'calculateMath',
         ],
      });
      const s = score(
         scoreDeterministic(
            twoProducts,
            trace([step('getProductInformation'), step('calculateMath')])
         ),
         'tools'
      );
      expect(s?.pass).toBe(false);
      expect(s?.detail).toContain('missing getProductInformation (1/2)');
   });

   test('a tool outside expected and allow_extra fails', () => {
      const review = evalCase({ tools: ['analyzeReview'] });
      const s = score(
         scoreDeterministic(
            review,
            trace([step('analyzeReview'), step('getExchangeRate')])
         ),
         'tools'
      );
      expect(s?.pass).toBe(false);
      expect(s?.detail).toContain('unexpected getExchangeRate');
   });

   test('tools: [] means no tools, unless allowed', () => {
      expect(
         score(
            scoreDeterministic(evalCase({}), trace([step('getWeather')])),
            'tools'
         )?.pass
      ).toBe(false);
      const allowed = evalCase({ allow_extra: ['getProductInformation'] });
      expect(
         score(
            scoreDeterministic(allowed, trace([step('getProductInformation')])),
            'tools'
         )?.pass
      ).toBe(true);
   });

   test('ordered requires the expected order as a subsequence', () => {
      const ordered = evalCase({
         tools: ['getExchangeRate', 'calculateMath'],
         ordered: true,
      });
      const pass = (names: ToolName[]) =>
         score(
            scoreDeterministic(ordered, trace(names.map((n) => step(n)))),
            'tools'
         )?.pass;
      expect(pass(['getExchangeRate', 'calculateMath', 'calculateMath'])).toBe(
         true
      );
      expect(pass(['calculateMath', 'getExchangeRate'])).toBe(false);
   });
});

describe('grounded_numbers scorer', () => {
   const c = evalCase({ tools: ['calculateMath'] });
   const grounded = (steps: StepTrace[], answer: string, input?: string) =>
      score(
         scoreDeterministic(c, trace(steps, answer, input)),
         'grounded_numbers'
      );

   test('rounded numbers, thousands separators and input numbers are grounded', () => {
      const s = grounded(
         [step('calculateMath', 'The result is 2497.5941')],
         'About **2,498 ILS** (2,497.59 exactly). With 1,500 ILS you are short.',
         'I have 1500 ILS'
      );
      expect(s?.pass).toBe(true);
   });

   test('a number that no tool produced is flagged, but does not fail the run', () => {
      const scores = scoreDeterministic(
         c,
         trace(
            [step('calculateMath', 'The result is 3054.0043')],
            'Total 3054 ILS; the LTE model would be 3210.26 ILS.'
         )
      );
      const s = score(scores, 'grounded_numbers');
      expect(s).toMatchObject({ pass: false, informational: true });
      expect(s?.detail).toContain('3210.26');
      expect(runPasses(scores)).toBe(true);
   });

   test('list markers are ignored; chat answers are not scored', () => {
      expect(
         grounded(
            [step('analyzeReview', 'Score: 6/10')],
            '1. Battery\n2. Screen\nScore 6/10'
         )?.pass
      ).toBe(true);
      expect(grounded([], 'Here are 3 jokes')).toBeUndefined();
   });
});

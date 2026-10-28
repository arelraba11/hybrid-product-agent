import { describe, expect, mock, test } from 'bun:test';
import { z } from 'zod';
import type { ChatRequest, ChatResult, Component, ToolCall } from '../../llm';
import {
   looksLikeTextToolCall,
   runAgent,
   TEXT_TOOL_CALL_REPAIR,
   type ChatFn,
} from './loop';
import { defineTool } from './tools';

// Fake tools: no network, no LLM.
const add = defineTool({
   name: 'add',
   description: 'Adds two numbers.',
   schema: z.object({ a: z.number(), b: z.number() }),
   async execute({ a, b }) {
      return { ok: true, output: `sum ${a + b}`, numericValue: a + b };
   },
});
const lookup = defineTool({
   name: 'lookup',
   description: 'Looks something up.',
   schema: z.object({ key: z.string().min(1) }),
   async execute({ key }) {
      return {
         ok: key !== 'missing',
         output: `value of ${key}`,
         numericValue: null,
      };
   },
});
const TOOLS = [add, lookup];

let nextId = 0;
const call = (name: string, args: unknown): ToolCall => ({
   id: `c${++nextId}`,
   name,
   arguments: typeof args === 'string' ? args : JSON.stringify(args),
});
const turn = (toolCalls: ToolCall[], text = ''): ChatResult => ({
   text,
   toolCalls,
   truncated: false,
});
const done = (text = 'Done.') => turn([], text);

type Script = Partial<Record<Component, (ChatResult | Error)[]>>;

/** Replays a fixed sequence of turns per component and records every request. */
function scripted(script: Script) {
   const requests: { component: Component; req: ChatRequest }[] = [];
   const chat = mock<ChatFn>(async (component, req) => {
      // Snapshot: the loop keeps appending to the same messages array.
      requests.push({
         component,
         req: { ...req, messages: [...req.messages] },
      });
      const next = script[component]?.shift();
      if (!next) throw new Error(`script exhausted for ${component}`);
      if (next instanceof Error) throw next;
      return next;
   });
   return { chat, requests };
}

const run = (chat: ChatFn, maxIterations = 6) =>
   runAgent('question', {
      tools: TOOLS,
      maxIterations,
      chat,
      systemPrompt: 'sys',
   });

describe('runAgent', () => {
   test('happy path: tool call, result back to the model, then stop', async () => {
      const { chat, requests } = scripted({
         planner: [turn([call('add', { a: 2, b: 3 })]), done()],
      });
      const r = await run(chat);

      expect(r.outcome).toBe('done');
      expect(r.repairs).toEqual([]);
      expect(r.escalation).toBeUndefined();
      expect(r.steps).toMatchObject([
         {
            step: 1,
            tool: 'add',
            parameters: { a: 2, b: 3 },
            ok: true,
            output: 'sum 5',
            numericValue: 5,
         },
      ]);
      // Second turn sees the assistant call and the tool result.
      expect(requests[1]!.req.messages.at(-1)).toMatchObject({
         role: 'tool',
         name: 'add',
         content: 'sum 5',
      });
   });

   test('parallel calls in one turn all run, in call order', async () => {
      const { chat } = scripted({
         planner: [
            turn([call('lookup', { key: 'x' }), call('add', { a: 1, b: 1 })]),
            done(),
         ],
      });
      const r = await run(chat);
      expect(r.steps.map((s) => s.tool)).toEqual(['lookup', 'add']);
   });

   test('no tool calls: done with no steps (caller answers with chat)', async () => {
      const { chat } = scripted({ planner: [done('Hello!')] });
      const r = await run(chat);
      expect(r).toMatchObject({ outcome: 'done', steps: [], repairs: [] });
      expect(r.attempts).toHaveLength(1);
   });

   test('repair succeeds: invalid args, error sent back, then valid args', async () => {
      const { chat, requests } = scripted({
         planner: [
            turn([call('add', { a: 'two', b: 3 })]),
            turn([call('add', { a: 2, b: 3 })]),
            done(),
         ],
      });
      const r = await run(chat);

      expect(r.outcome).toBe('done');
      expect(r.escalation).toBeUndefined();
      expect(r.repairs).toHaveLength(1);
      expect(r.repairs[0]).toMatchObject({ attempt: 1, iteration: 1 });
      expect(r.repairs[0]!.reason).toContain('Invalid arguments for add');
      expect(r.steps).toHaveLength(1);
      expect(String(requests[1]!.req.messages.at(-1)?.content)).toStartWith(
         'Error: Invalid arguments for add'
      );
      expect(r.attempts[0]!.iterations[0]!.toolCalls[0]!.error).toBeTruthy();
   });

   test('unknown tool counts as a validation error', async () => {
      const { chat } = scripted({
         planner: [
            turn([call('divide', { a: 1 })]),
            turn([call('add', { a: 1, b: 2 })]),
            done(),
         ],
      });
      const r = await run(chat);
      expect(r.repairs[0]!.reason).toContain('Unknown tool "divide"');
      expect(r.outcome).toBe('done');
   });

   test('unparseable arguments count as a validation error', async () => {
      const { chat } = scripted({
         planner: [turn([call('add', '{"a": 1, "b":')]), done()],
      });
      const r = await run(chat);
      expect(r.repairs[0]!.reason).toContain('not valid JSON');
   });

   test('repair fails: second invalid turn escalates to plannerFallback', async () => {
      const { chat, requests } = scripted({
         planner: [
            turn([call('add', { a: 'x' })]),
            turn([call('add', { b: 'y' })]),
         ],
         plannerFallback: [turn([call('add', { a: 4, b: 4 })]), done()],
      });
      const r = await run(chat);

      expect(r.outcome).toBe('done');
      expect(r.escalation?.kind).toBe('validation');
      expect(r.repairs).toHaveLength(1);
      expect(r.attempts.map((a) => a.component)).toEqual([
         'planner',
         'plannerFallback',
      ]);
      // The fallback restarts from scratch: system + user only.
      const firstFallback = requests.find(
         (q) => q.component === 'plannerFallback'
      )!;
      expect(firstFallback.req.messages.map((m) => m.role)).toEqual([
         'system',
         'user',
      ]);
      expect(r.steps).toMatchObject([{ tool: 'add', numericValue: 8 }]);
   });

   test('tool call written as text: repaired, then escalated if repeated', async () => {
      const textCall = '{"name": "add", "arguments": {"a": 1, "b": 2}}';
      const { chat, requests } = scripted({
         planner: [done(textCall), done(textCall)],
         plannerFallback: [done('Hi there.')],
      });
      const r = await run(chat);

      expect(r.repairs).toHaveLength(1);
      expect(r.repairs[0]!.reason).toBe('tool call emitted as text');
      expect(requests[1]!.req.messages.at(-1)).toEqual({
         role: 'user',
         content: TEXT_TOOL_CALL_REPAIR,
      });
      expect(r.escalation?.kind).toBe('validation');
      expect(r.attempts[0]!.iterations[0]!.textToolCall).toBe(true);
      expect(r.outcome).toBe('done');
   });

   test('max iterations: escalates, and the fallback failing too ends as failed', async () => {
      const forever = () => turn([call('lookup', { key: 'k' })]);
      const { chat } = scripted({
         planner: [forever(), forever(), forever()],
         plannerFallback: [forever(), forever(), forever()],
      });
      const r = await run(chat, 3);

      expect(r.escalation?.kind).toBe('max_iterations');
      expect(r.outcome).toBe('failed');
      expect(r.failure?.kind).toBe('max_iterations');
      // The answer is built from the fallback's executed steps.
      expect(r.steps).toHaveLength(3);
      expect(chat).toHaveBeenCalledTimes(6);
   });

   test('provider error or timeout escalates at once, without a repair', async () => {
      const { chat } = scripted({
         planner: [
            new Error('planner (ollama/gemma4:12b) timed out after 60000ms'),
         ],
         plannerFallback: [done('ok')],
      });
      const r = await run(chat);

      expect(r.repairs).toEqual([]);
      expect(r.escalation).toEqual({
         kind: 'provider_error',
         message: 'planner (ollama/gemma4:12b) timed out after 60000ms',
      });
      expect(r.outcome).toBe('done');
   });

   test('truncated output and empty first turn escalate', async () => {
      const truncated = scripted({
         planner: [{ ...done(''), truncated: true }],
         plannerFallback: [done()],
      });
      expect((await run(truncated.chat)).escalation?.kind).toBe('truncated');

      const empty = scripted({
         planner: [done('')],
         plannerFallback: [done()],
      });
      expect((await run(empty.chat)).escalation?.kind).toBe('empty_output');
   });

   test('both attempts fail with no steps: failed, empty steps', async () => {
      const { chat } = scripted({
         planner: [new Error('down')],
         plannerFallback: [new Error('also down')],
      });
      const r = await run(chat);
      expect(r).toMatchObject({
         outcome: 'failed',
         steps: [],
         failure: { kind: 'provider_error', message: 'also down' },
      });
   });

   test('a tool that reports ok: false is a step, not a validation error', async () => {
      const { chat, requests } = scripted({
         planner: [turn([call('lookup', { key: 'missing' })]), done()],
      });
      const r = await run(chat);
      expect(r.repairs).toEqual([]);
      expect(r.steps[0]).toMatchObject({ ok: false });
      expect(requests[1]!.req.messages.at(-1)?.content).toBe(
         'Tool error: value of missing'
      );
   });
});

describe('looksLikeTextToolCall', () => {
   const names = ['getWeather', 'calculateMath'];
   test.each([
      ['{"name": "getWeather", "arguments": {"city": "Oslo"}}', true],
      ['```json\n{"tool": "calculateMath"}\n```', true],
      ['getWeather(city="Oslo")', true],
      ['Sure! Here is a joke about programmers.', false],
      ['{"plan": []}', false],
      ['I can check the weather for you.', false],
   ])('%s → %p', (text, expected) => {
      expect(looksLikeTextToolCall(text, names)).toBe(expected);
   });
});

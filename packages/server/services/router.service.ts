import { collectLlmCalls, type LlmCall } from '../llm';
import {
   historyRepository,
   type HistoryStore,
} from '../repositories/history.repository';
import { handleWithAgent } from './agent/handle';
import type { RouterTrace } from './router/types';

function sumTotals(calls: LlmCall[]): RouterTrace['totals'] {
   return {
      inputTokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
      costUsd: calls.some((c) => c.costUsd == null)
         ? null
         : calls.reduce((n, c) => n + (c.costUsd ?? 0), 0),
   };
}

export type HandleOptions = {
   /** Defaults to the persistent history.json store. */
   history?: HistoryStore;
};

export const routerService = {
   async handleUserMessage(
      conversationId: string,
      userInput: string,
      opts: HandleOptions = {}
   ): Promise<{ message: string; intent?: string; trace?: RouterTrace }> {
      console.log('ROUTER SERVICE HIT 🧠', { conversationId, userInput });
      const history: HistoryStore = opts.history ?? historyRepository;

      if (userInput.trim() === '/reset') {
         await history.resetAll();
         return { message: 'בוצע reset ✅ התחלנו שיחה חדשה.' };
      }

      const start = performance.now();
      const { result: out, calls } = await collectLlmCalls(() =>
         handleWithAgent(userInput, conversationId, history)
      );

      const trace: RouterTrace = {
         input: userInput,
         ...out.trace,
         finalAnswer: out.message,
         latencyMs: performance.now() - start,
         llmCalls: calls,
         totals: sumTotals(calls),
      };

      history.append(conversationId, {
         role: 'user',
         content: userInput,
      });
      history.append(conversationId, {
         role: 'assistant',
         content: out.message,
      });
      await history.save();

      return { message: out.message, intent: out.intent, trace };
   },
};

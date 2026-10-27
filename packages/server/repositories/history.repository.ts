import path from 'path';

export type ChatRole = 'user' | 'assistant';
export type ChatMessage = { role: ChatRole; content: string };

type HistoryState = Record<string, ChatMessage[]>; // conversationId -> messages

const HISTORY_PATH = path.join(process.cwd(), 'history.json');

let state: HistoryState = {};

export const historyRepository = {
   async load() {
      const file = Bun.file(HISTORY_PATH);
      if (await file.exists()) {
         state = (await file.json()) as HistoryState;
         return { loaded: true, conversations: Object.keys(state).length };
      }
      state = {};
      return { loaded: false, conversations: 0 };
   },

   get(conversationId: string): ChatMessage[] {
      return state[conversationId] ?? [];
   },

   append(conversationId: string, msg: ChatMessage) {
      if (!state[conversationId]) state[conversationId] = [];
      state[conversationId].push(msg);
   },

   async save() {
      await Bun.write(HISTORY_PATH, JSON.stringify(state, null, 2));
   },

   async resetAll() {
      state = {};
      // delete file if exists
      const file = Bun.file(HISTORY_PATH);
      if (await file.exists()) {
         await Bun.write(HISTORY_PATH, ''); // ensure file not locked
         // Bun doesn't have unlink built-in; use node:fs/promises (works in Bun)
         const { unlink } = await import('node:fs/promises');
         await unlink(HISTORY_PATH).catch(() => {});
      }
   },

   path() {
      return HISTORY_PATH;
   },
};

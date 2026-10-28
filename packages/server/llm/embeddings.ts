// packages/server/llm/embeddings.ts
// Embeddings are always local (Ollama). Changing EMBEDDING_MODEL requires a full reindex.
import { LLM_TIMEOUT_MS, OLLAMA_URL } from './config';
import { recordLlmCall } from './usage';

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'embeddinggemma';

export type EmbedDocument = { title?: string; text: string };

type OllamaEmbedResponse = {
   embeddings: number[][];
   prompt_eval_count?: number;
};

// embeddinggemma was trained with task prefixes; other models get raw text.
function usesGemmaPrompts() {
   return EMBEDDING_MODEL.startsWith('embeddinggemma');
}

function queryInput(text: string) {
   return usesGemmaPrompts() ? `task: search result | query: ${text}` : text;
}

function documentInput(doc: EmbedDocument) {
   return usesGemmaPrompts()
      ? `title: ${doc.title || 'none'} | text: ${doc.text}`
      : doc.text;
}

async function embedRaw(inputs: string[]): Promise<Float32Array[]> {
   const start = performance.now();
   const signal = AbortSignal.timeout(LLM_TIMEOUT_MS);
   const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
   }).catch((err: unknown) => {
      if (signal.aborted) {
         throw new Error(
            `Ollama embed (${EMBEDDING_MODEL}) timed out after ${LLM_TIMEOUT_MS}ms`
         );
      }
      throw err;
   });

   if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
         `Ollama embed error: ${res.status} ${res.statusText} - ${text}`
      );
   }

   const data = (await res.json()) as OllamaEmbedResponse;
   recordLlmCall({
      component: 'embeddings',
      provider: 'ollama',
      model: EMBEDDING_MODEL,
      latencyMs: performance.now() - start,
      inputTokens: data.prompt_eval_count ?? null,
      outputTokens: 0,
      costUsd: 0,
   });

   if (data.embeddings?.length !== inputs.length) {
      throw new Error(
         `Ollama embed returned ${data.embeddings?.length ?? 0} vectors for ${inputs.length} inputs`
      );
   }

   return data.embeddings.map((v) => Float32Array.from(v));
}

export async function embedQuery(text: string): Promise<Float32Array> {
   const [vec] = await embedRaw([queryInput(text)]);
   if (!vec) throw new Error('Ollama embed returned no vector for query');
   return vec;
}

export function embedDocuments(docs: EmbedDocument[]): Promise<Float32Array[]> {
   return embedRaw(docs.map(documentInput));
}

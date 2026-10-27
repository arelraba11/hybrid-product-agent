// packages/server/llm/embeddings.ts
// Embeddings are always local (Ollama). Changing EMBEDDING_MODEL requires a full reindex.

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'embeddinggemma';

export type EmbedDocument = { title?: string; text: string };

type OllamaEmbedResponse = { embeddings: number[][] };

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
   const res = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
   });

   if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
         `Ollama embed error: ${res.status} ${res.statusText} - ${text}`
      );
   }

   const data = (await res.json()) as OllamaEmbedResponse;
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

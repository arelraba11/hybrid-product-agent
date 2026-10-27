import { llmClient } from '../../llm/client';
import { RAG_GENERATION_PROMPT } from '../../prompts/prompts';

const PY_KB_URL = process.env.PY_KB_URL || 'http://localhost:8000/search_kb';

type KbChunk = {
   text: string;
   metadata?: Record<string, unknown>;
   distance?: number;
};

type SearchKbResponse = {
   chunks: KbChunk[];
};

async function retrieveProductChunks(
   productName: string,
   query: string,
   topK = 4
): Promise<KbChunk[]> {
   console.time('rag:retrieval');
   try {
      const res = await fetch(PY_KB_URL, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
            query,
            product_name: productName,
            top_k: topK,
         }),
      });

      if (!res.ok) {
         const text = await res.text().catch(() => '');
         throw new Error(`KB search failed (${res.status}): ${text}`);
      }

      const payload = (await res.json()) as SearchKbResponse;
      return payload.chunks ?? [];
   } finally {
      console.timeEnd('rag:retrieval');
   }
}

function buildChunksText(chunks: KbChunk[]): string {
   if (!chunks.length) return 'No relevant chunks found.';

   return chunks
      .map((chunk, idx) => {
         const src = String(chunk.metadata?.source_file ?? 'unknown_source');
         return `Chunk ${idx + 1} (source: ${src})\n${chunk.text}`;
      })
      .join('\n\n');
}

async function generateAnswer(
   productName: string,
   query: string,
   chunks: KbChunk[]
): Promise<string> {
   console.time('rag:generation');
   try {
      const prompt = RAG_GENERATION_PROMPT.replace('{{USER_QUERY}}', query)
         .replace('{{PRODUCT_NAME}}', productName)
         .replace('{{RETRIEVED_CHUNKS}}', buildChunksText(chunks));

      const response = await llmClient.generateText({
         model: 'gpt-4o-mini',
         prompt,
         temperature: 0.1,
         maxTokens: 300,
      });

      return response.text.trim();
   } finally {
      console.timeEnd('rag:generation');
   }
}

export async function getProductInformation(
   productName: string,
   query: string
): Promise<string> {
   console.time('rag:total');
   try {
      const chunks = await retrieveProductChunks(productName, query);

      if (!chunks.length) {
         return `I couldn't find information for "${productName}" in the local knowledge base.`;
      }

      return await generateAnswer(productName, query, chunks);
   } catch (error) {
      console.error('getProductInformation failed:', error);
      return 'Product knowledge base is currently unavailable. Please try again.';
   } finally {
      console.timeEnd('rag:total');
   }
}

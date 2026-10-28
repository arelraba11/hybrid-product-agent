import { llm } from '../../llm';
import { RAG_GENERATION_PROMPT } from '../../prompts/prompts';
import { searchKb } from '../kb/searchKb';
import type { KbHit } from '../kb/vectorSearch';

async function retrieveProductChunks(
   productName: string,
   query: string,
   topK = 4
): Promise<KbHit[]> {
   console.time('rag:retrieval');
   try {
      return await searchKb(query, productName, topK);
   } finally {
      console.timeEnd('rag:retrieval');
   }
}

function buildChunksText(chunks: KbHit[]): string {
   if (!chunks.length) return 'No relevant chunks found.';

   return chunks
      .map((chunk, idx) => {
         const src = chunk.metadata.source_file;
         return `Chunk ${idx + 1} (source: ${src})\n${chunk.text}`;
      })
      .join('\n\n');
}

async function generateAnswer(
   productName: string,
   query: string,
   chunks: KbHit[]
): Promise<string> {
   console.time('rag:generation');
   try {
      const prompt = RAG_GENERATION_PROMPT.replace('{{USER_QUERY}}', query)
         .replace('{{PRODUCT_NAME}}', productName)
         .replace('{{RETRIEVED_CHUNKS}}', buildChunksText(chunks));

      const text = await llm.generate('rag', {
         prompt,
         temperature: 0.1,
      });

      return text.trim();
   } finally {
      console.timeEnd('rag:generation');
   }
}

/** ok: false only when retrieval or generation fails; "not in the KB" is a valid answer. */
export async function productInformation(
   productName: string,
   query: string
): Promise<{ ok: boolean; text: string }> {
   console.time('rag:total');
   try {
      const chunks = await retrieveProductChunks(productName, query);

      if (!chunks.length) {
         return {
            ok: true,
            text: `I couldn't find information for "${productName}" in the local knowledge base.`,
         };
      }

      return {
         ok: true,
         text: await generateAnswer(productName, query, chunks),
      };
   } catch (error) {
      console.error('getProductInformation failed:', error);
      return {
         ok: false,
         text: 'Product knowledge base is currently unavailable. Please try again.',
      };
   } finally {
      console.timeEnd('rag:total');
   }
}

// Port of the former python-service /search_kb endpoint:
// top-k + optional product filter, with a global retry when the filter finds nothing.
import { EMBEDDING_MODEL, embedQuery } from '../../llm/embeddings';
import { kbRepository } from '../../repositories/kb.repository';
import { bruteForceIndex, type KbHit, type VectorIndex } from './vectorSearch';

const index: VectorIndex = bruteForceIndex;

let indexChecked = false;

async function warnIfIndexStale() {
   if (indexChecked) return;
   indexChecked = true;

   const models = await kbRepository.embeddingModels();
   if (!models.length) {
      console.warn(
         '[kb] Knowledge base index is empty. Run `bun run index-kb` first.'
      );
   } else if (models.some((m) => m !== EMBEDDING_MODEL)) {
      console.warn(
         `[kb] Index was built with ${models.join(', ')} but EMBEDDING_MODEL is ${EMBEDDING_MODEL}. Run \`bun run index-kb\`.`
      );
   }
}

export async function searchKb(
   query: string,
   productName?: string,
   topK = 4
): Promise<KbHit[]> {
   await warnIfIndexStale();

   const k = Math.min(Math.max(Math.trunc(topK), 1), 10);
   const queryVec = await embedQuery(query);
   const filter = productName?.toLowerCase().trim() || undefined;

   const hits = await index.search(queryVec, { topK: k, productName: filter });

   // If strict product filter returned nothing, retry globally.
   if (filter && !hits.length) {
      return index.search(queryVec, { topK: k });
   }

   return hits;
}

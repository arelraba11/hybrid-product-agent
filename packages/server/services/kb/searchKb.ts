// Port of the former python-service /search_kb endpoint:
// top-k + optional product filter (token/prefix match against stored product names,
// see productMatch.ts), with a global retry when the filter finds nothing.
import { EMBEDDING_MODEL, embedQuery } from '../../llm/embeddings';
import { kbRepository } from '../../repositories/kb.repository';
import { matchProductNames } from './productMatch';
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
   const filter = productName?.trim()
      ? matchProductNames(productName, await kbRepository.productNames())
      : [];

   if (productName?.trim()) {
      console.log(
         filter.length
            ? `[kb] product filter "${productName}" → [${filter.join(', ')}]`
            : `[kb] product filter "${productName}" → no match, global search`
      );
   }

   const hits = filter.length
      ? await index.search(queryVec, { topK: k, productNames: filter })
      : [];

   // No matching product (or no rows for it): search globally.
   return hits.length ? hits : index.search(queryVec, { topK: k });
}

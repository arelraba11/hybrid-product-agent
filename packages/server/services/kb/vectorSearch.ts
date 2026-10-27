// Vector search behind a small interface so a real vector index can replace
// the brute-force implementation without touching callers.
import { kbRepository } from '../../repositories/kb.repository';

export type KbHit = {
   text: string;
   metadata: { source_file: string; product_name: string; chunk_index: number };
   distance: number; // cosine distance: 1 - cosine similarity
};

export type VectorSearchOptions = { topK: number; productName?: string };

export interface VectorIndex {
   search(queryVec: Float32Array, opts: VectorSearchOptions): Promise<KbHit[]>;
}

export function vectorToBytes(vec: Float32Array): Uint8Array<ArrayBuffer> {
   return new Uint8Array(Float32Array.from(vec).buffer);
}

export function bytesToVector(bytes: Uint8Array): Float32Array {
   // Copy into a fresh buffer: the source view may not be 4-byte aligned.
   return new Float32Array(Uint8Array.from(bytes).buffer);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
   if (a.length !== b.length) {
      throw new Error(
         `Embedding dimension mismatch (${a.length} vs ${b.length}) — reindex the KB`
      );
   }

   let dot = 0;
   let normA = 0;
   let normB = 0;
   for (let i = 0; i < a.length; i++) {
      const x = a[i]!;
      const y = b[i]!;
      dot += x * y;
      normA += x * x;
      normB += y * y;
   }

   if (normA === 0 || normB === 0) return 0;
   return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Loads the (filtered) rows and scores them in TS. Fine for a few hundred chunks.
export const bruteForceIndex: VectorIndex = {
   async search(queryVec, { topK, productName }) {
      const rows = await kbRepository.findByProduct(productName);

      return rows
         .map((row) => ({
            text: row.text,
            metadata: {
               source_file: row.sourceFile,
               product_name: row.productName,
               chunk_index: row.chunkIndex,
            },
            distance:
               1 - cosineSimilarity(queryVec, bytesToVector(row.embedding)),
         }))
         .sort((a, b) => a.distance - b.distance)
         .slice(0, topK);
   },
};

// (Re)index data/products/*.txt into the kb_chunks table.
// Port of the former python-service/index_kb.py. Run with `bun run index-kb` from the repo root.
import path from 'path';
import { readdir } from 'node:fs/promises';
import { EMBEDDING_MODEL, embedDocuments } from '../llm/embeddings';
import { kbRepository, type NewKbChunk } from '../repositories/kb.repository';
import { vectorToBytes } from '../services/kb/vectorSearch';

const DATA_DIR = path.resolve(
   process.env.PRODUCT_DATA_DIR ||
      path.join(import.meta.dir, '../../../data/products')
);

export function chunkText(
   text: string,
   chunkSizeWords = 220,
   overlapWords = 40
): string[] {
   const words = text.split(/\s+/).filter(Boolean);
   if (!words.length) return [];

   const chunks: string[] = [];
   const step = Math.max(chunkSizeWords - overlapWords, 1);

   for (let start = 0; start < words.length; start += step) {
      const chunkWords = words.slice(start, start + chunkSizeWords);
      if (!chunkWords.length) continue;
      chunks.push(chunkWords.join(' '));
      if (start + chunkSizeWords >= words.length) break;
   }

   return chunks;
}

export function stemToProductName(stem: string): string {
   return stem.replaceAll('_', ' ').replaceAll('-', ' ').trim().toLowerCase();
}

async function main() {
   console.log(`[index_kb] Embedding model: ${EMBEDDING_MODEL}`);
   console.log(`[index_kb] Reading: ${DATA_DIR}`);

   const files = (await readdir(DATA_DIR))
      .filter((f) => f.endsWith('.txt'))
      .sort();
   if (!files.length) throw new Error(`No .txt files found in ${DATA_DIR}`);

   const pending: Array<Omit<NewKbChunk, 'embedding' | 'embeddingModel'>> = [];

   for (const file of files) {
      const text = await Bun.file(path.join(DATA_DIR, file)).text();
      const chunks = chunkText(text);
      const productName = stemToProductName(path.parse(file).name);

      console.log(`[index_kb] ${file}: ${chunks.length} chunks`);

      chunks.forEach((chunk, idx) => {
         pending.push({
            productName,
            sourceFile: file,
            chunkIndex: idx + 1,
            text: chunk,
         });
      });
   }

   console.log(`[index_kb] Encoding ${pending.length} chunks...`);
   const vectors = await embedDocuments(
      pending.map((c) => ({ title: c.productName, text: c.text }))
   );

   await kbRepository.replaceAll(
      pending.map((c, i) => ({
         ...c,
         embedding: vectorToBytes(vectors[i]!),
         embeddingModel: EMBEDDING_MODEL,
      }))
   );

   console.log('[index_kb] Done.');
   console.log(
      `[index_kb] Indexed chunks: ${pending.length} (dim ${vectors[0]?.length ?? 0})`
   );
}

if (import.meta.main) {
   main().catch((err) => {
      console.error('[index_kb] failed:', err);
      process.exit(1);
   });
}

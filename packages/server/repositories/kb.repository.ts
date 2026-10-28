import { PrismaClient, type KbChunk } from '../generated/prisma';

const prisma = new PrismaClient();

export type NewKbChunk = Omit<KbChunk, 'id'>;

export const kbRepository = {
   async replaceAll(chunks: NewKbChunk[]) {
      await prisma.$transaction([
         prisma.kbChunk.deleteMany(),
         prisma.kbChunk.createMany({ data: chunks }),
      ]);
   },

   findByProduct(productNames?: string[]): Promise<KbChunk[]> {
      return prisma.kbChunk.findMany({
         where: productNames
            ? { productName: { in: productNames } }
            : undefined,
      });
   },

   async productNames(): Promise<string[]> {
      const rows = await prisma.kbChunk.findMany({
         select: { productName: true },
         distinct: ['productName'],
      });
      return rows.map((r) => r.productName);
   },

   async embeddingModels(): Promise<string[]> {
      const rows = await prisma.kbChunk.findMany({
         select: { embeddingModel: true },
         distinct: ['embeddingModel'],
      });
      return rows.map((r) => r.embeddingModel);
   },
};

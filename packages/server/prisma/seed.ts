// Local dev seed for the reviews feature.
// Product names match data/products/*.txt so reviews and RAG refer to the same products.
// No prices or specs here: the knowledge base is the single source of truth for product facts.
import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

type SeedProduct = {
   name: string;
   reviews: Array<{ author: string; rating: number; content: string }>;
};

const products: SeedProduct[] = [
   {
      name: 'EvoPhone X',
      reviews: [
         {
            author: 'Dana',
            rating: 5,
            content:
               'Smooth and fast for everything I do. The screen looks great and photos come out sharp.',
         },
         {
            author: 'Omer',
            rating: 3,
            content:
               'Nice phone overall, but the battery drains faster than I hoped on heavy days.',
         },
         {
            author: 'Lior',
            rating: 2,
            content:
               'Runs warm while gaming and the charger was missing from the box. Disappointed.',
         },
      ],
   },
   {
      name: 'NeoBook Air 14 Laptop',
      reviews: [
         {
            author: 'Maya',
            rating: 5,
            content:
               'Light enough to carry all day and the keyboard is a pleasure to type on.',
         },
         {
            author: 'Yoni',
            rating: 4,
            content:
               'Great for work and study. Speakers are a bit thin but everything else is solid.',
         },
         {
            author: 'Noa',
            rating: 2,
            content:
               'The fan gets loud under load and the trackpad sometimes misses clicks.',
         },
      ],
   },
   {
      name: 'BrewMaster Y Coffee Machine',
      reviews: [
         {
            author: 'Avi',
            rating: 5,
            content:
               'Makes excellent espresso every morning. Easy to clean, too.',
         },
         {
            author: 'Shira',
            rating: 3,
            content:
               'Coffee tastes good, but it is louder than I expected and the water tank is awkward to refill.',
         },
         {
            author: 'Eitan',
            rating: 1,
            content:
               'Started leaking after a few weeks. Support took a long time to respond.',
         },
      ],
   },
   {
      name: 'ElectroRide Z Vehicle',
      reviews: [
         {
            author: 'Tamar',
            rating: 5,
            content:
               'Quiet, comfortable and fun to drive. Charging at home has been painless.',
         },
         {
            author: 'Gil',
            rating: 4,
            content:
               'Really enjoy it in the city. The infotainment software could be more responsive.',
         },
         {
            author: 'Rotem',
            rating: 2,
            content:
               'Range drops noticeably in cold weather and the service center is far from me.',
         },
      ],
   },
   {
      name: 'PrintForge 3D Printer',
      reviews: [
         {
            author: 'Itay',
            rating: 4,
            content:
               'Prints are clean once calibrated. Setup took an evening but was worth it.',
         },
         {
            author: 'Michal',
            rating: 3,
            content:
               'Good quality output, though the bed leveling needs attention more often than I would like.',
         },
         {
            author: 'Ben',
            rating: 1,
            content:
               'Nozzle clogged repeatedly and the included instructions were confusing.',
         },
      ],
   },
];

async function main() {
   // Idempotent: wipe and recreate, and reset autoincrement so ids stay 1..N.
   await prisma.summary.deleteMany();
   await prisma.review.deleteMany();
   await prisma.product.deleteMany();
   await prisma.$executeRawUnsafe(
      `DELETE FROM sqlite_sequence WHERE name IN ('products', 'reviews', 'summaries')`
   );

   for (const p of products) {
      const created = await prisma.product.create({
         data: { name: p.name, reviews: { create: p.reviews } },
      });
      console.log(
         `[seed] product ${created.id}: ${created.name} (${p.reviews.length} reviews)`
      );
   }
}

main()
   .catch((err) => {
      console.error('[seed] failed:', err);
      process.exitCode = 1;
   })
   .finally(() => prisma.$disconnect());

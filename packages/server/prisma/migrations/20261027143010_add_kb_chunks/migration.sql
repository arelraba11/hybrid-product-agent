-- CreateTable
CREATE TABLE "kb_chunks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productName" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" BLOB NOT NULL,
    "embeddingModel" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "kb_chunks_productName_idx" ON "kb_chunks"("productName");

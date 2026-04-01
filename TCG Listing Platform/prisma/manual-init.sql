-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sellerLabel" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'POKEMON',
    "intakeMode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "exportReady" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "shippingType" TEXT,
    "shippingCost" TEXT,
    "returnsAcceptedOption" TEXT,
    "returnsWithinOption" TEXT,
    "refundOption" TEXT,
    "shippingCostPaidByOption" TEXT,
    "dispatchTimeMax" INTEGER,
    "cardConditionDescriptor" TEXT,
    "descriptionTemplate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "durationSeconds" INTEGER,
    "imageCount" INTEGER,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Upload_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Detection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "uploadId" TEXT,
    "sourceLabel" TEXT NOT NULL,
    "suggestedCardId" TEXT,
    "cardName" TEXT,
    "setName" TEXT,
    "cardNumber" TEXT,
    "rarity" TEXT,
    "confidence" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "notes" TEXT,
    "titleOverride" TEXT,
    "priceOverride" TEXT,
    "quantityOverride" INTEGER,
    "conditionOverride" TEXT,
    "excludeFromExport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Detection_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Detection_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Detection_suggestedCardId_fkey" FOREIGN KEY ("suggestedCardId") REFERENCES "CatalogCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "detectionId" TEXT NOT NULL,
    "suggestedMatch" TEXT NOT NULL,
    "alternateMatches" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedCardId" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewItem_detectionId_fkey" FOREIGN KEY ("detectionId") REFERENCES "Detection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewItem_resolvedCardId_fkey" FOREIGN KEY ("resolvedCardId") REFERENCES "CatalogCard" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalSource" TEXT NOT NULL,
    "externalSetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "series" TEXT,
    "printedTotal" INTEGER,
    "total" INTEGER,
    "ptcgoCode" TEXT,
    "releaseDate" TEXT,
    "updatedAtSource" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CatalogCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setId" TEXT,
    "externalSource" TEXT NOT NULL,
    "externalCardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "setCode" TEXT,
    "cardNumber" TEXT NOT NULL,
    "rarity" TEXT,
    "supertype" TEXT,
    "subtypes" TEXT,
    "imageSmallUrl" TEXT,
    "imageLargeUrl" TEXT,
    "imageHashFull" TEXT,
    "imageHashCandidates" TEXT,
    "rawSourceJson" TEXT,
    "updatedAtSource" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogCard_setId_fkey" FOREIGN KEY ("setId") REFERENCES "CatalogSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExportRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "filePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExportRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Upload_batchId_idx" ON "Upload"("batchId");

-- CreateIndex
CREATE INDEX "Detection_batchId_idx" ON "Detection"("batchId");

-- CreateIndex
CREATE INDEX "Detection_uploadId_idx" ON "Detection"("uploadId");

-- CreateIndex
CREATE INDEX "Detection_suggestedCardId_idx" ON "Detection"("suggestedCardId");

-- CreateIndex
CREATE INDEX "ReviewItem_batchId_idx" ON "ReviewItem"("batchId");

-- CreateIndex
CREATE INDEX "ReviewItem_detectionId_idx" ON "ReviewItem"("detectionId");

-- CreateIndex
CREATE INDEX "ReviewItem_resolvedCardId_idx" ON "ReviewItem"("resolvedCardId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSet_externalSetId_key" ON "CatalogSet"("externalSetId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCard_externalCardId_key" ON "CatalogCard"("externalCardId");

-- CreateIndex
CREATE INDEX "CatalogCard_setId_idx" ON "CatalogCard"("setId");

-- CreateIndex
CREATE INDEX "CatalogCard_name_idx" ON "CatalogCard"("name");

-- CreateIndex
CREATE INDEX "CatalogCard_normalizedName_idx" ON "CatalogCard"("normalizedName");

-- CreateIndex
CREATE INDEX "CatalogCard_setName_cardNumber_idx" ON "CatalogCard"("setName", "cardNumber");

-- CreateIndex
CREATE INDEX "ExportRun_batchId_idx" ON "ExportRun"("batchId");

const { PrismaClient } = require("@prisma/client");
const mockBatches = require("../data/mock-batches.json");

const prisma = new PrismaClient();

function toEnumIntakeMode(value) {
  return value === "video" ? "VIDEO" : "IMAGES";
}

function toEnumBatchStatus(value) {
  return value.toUpperCase();
}

function toEnumUploadStatus(value) {
  return value.toUpperCase();
}

function toEnumDetectionStatus(value) {
  return value.toUpperCase();
}

function normalizeName(value) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

async function resetData() {
  await prisma.reviewItem.deleteMany();
  await prisma.detection.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.exportRun.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.catalogCard.deleteMany();
  await prisma.catalogSet.deleteMany();
}

async function seedCatalog() {
  const setRecords = [
    {
      externalSource: "pokemon_tcg_api",
      externalSetId: "sv8",
      name: "Surging Sparks",
      code: "SSP",
    },
    {
      externalSource: "pokemon_tcg_api",
      externalSetId: "sv3",
      name: "Obsidian Flames",
      code: "OBF",
    },
    {
      externalSource: "pokemon_tcg_api",
      externalSetId: "sv5",
      name: "Temporal Forces",
      code: "TEF",
    },
    {
      externalSource: "pokemon_tcg_api",
      externalSetId: "sv2",
      name: "Paldea Evolved",
      code: "PAL",
    },
    {
      externalSource: "pokemon_tcg_api",
      externalSetId: "sv45",
      name: "Paldean Fates",
      code: "PAF",
    },
  ];

  const setsByName = {};
  for (const set of setRecords) {
    const created = await prisma.catalogSet.create({ data: set });
    setsByName[created.name] = created;
  }

  const cardRecords = [
    ["Pikachu ex", "Surging Sparks", "057/191", "Double Rare"],
    ["Charizard ex", "Obsidian Flames", "125/197", "Double Rare"],
    ["Buddy-Buddy Poffin", "Temporal Forces", "144/162", "Uncommon"],
    ["Iono", "Paldea Evolved", "185/193", "Special Illustration Rare"],
    ["Squawkabilly ex", "Paldea Evolved", "169/193", "Double Rare"],
    ["Nest Ball", "Paldean Fates", "084/091", "Shiny Rare"],
  ];

  const cardsByLabel = {};
  for (const [name, setName, cardNumber, rarity] of cardRecords) {
    const set = setsByName[setName];
    const created = await prisma.catalogCard.create({
      data: {
        setId: set.id,
        externalSource: "pokemon_tcg_api",
        externalCardId: `${set.externalSetId}-${cardNumber}`,
        name,
        normalizedName: normalizeName(name),
        setName,
        setCode: set.code,
        cardNumber,
        rarity,
      },
    });

    cardsByLabel[`${name}::${setName}::${cardNumber}`] = created;
  }

  return cardsByLabel;
}

async function seedBatches(cardsByLabel) {
  for (const batch of mockBatches) {
    const createdBatch = await prisma.batch.create({
      data: {
        id: batch.id,
        name: batch.name,
        sellerLabel: batch.sellerLabel,
        game: "POKEMON",
        intakeMode: toEnumIntakeMode(batch.intakeMode),
        status: toEnumBatchStatus(batch.status),
        itemCount: batch.itemCount,
        reviewCount: batch.reviewCount,
        exportReady: batch.exportReady,
      },
    });

    const uploadsById = {};

    for (const upload of batch.uploads) {
      const createdUpload = await prisma.upload.create({
        data: {
          id: upload.id,
          batchId: createdBatch.id,
          kind: toEnumIntakeMode(upload.type),
          fileName: upload.fileName,
          status: toEnumUploadStatus(upload.status),
          durationSeconds: upload.durationLabel
            ? Number(upload.durationLabel.split(":")[0]) * 60 +
              Number(upload.durationLabel.split(":")[1])
            : null,
          imageCount: upload.imageCount ?? null,
        },
      });

      uploadsById[createdUpload.id] = createdUpload;
    }

    const detectionsBySource = {};

    for (const detection of batch.detections) {
      const card =
        cardsByLabel[`${detection.cardName}::${detection.setName}::${detection.cardNumber}`] ?? null;

      const upload = batch.uploads[0] ? uploadsById[batch.uploads[0].id] : null;

      const createdDetection = await prisma.detection.create({
        data: {
          id: detection.id,
          batchId: createdBatch.id,
          uploadId: upload ? upload.id : null,
          sourceLabel: detection.frameLabel,
          suggestedCardId: card ? card.id : null,
          cardName: detection.cardName,
          setName: detection.setName,
          cardNumber: detection.cardNumber,
          rarity: detection.rarity,
          confidence: detection.confidence,
          status: toEnumDetectionStatus(detection.status),
          notes: detection.notes ?? null,
        },
      });

      detectionsBySource[createdDetection.sourceLabel] = createdDetection;
    }

    for (const review of batch.reviewQueue) {
      const detection = detectionsBySource[review.frameLabel];

      if (!detection) {
        continue;
      }

      await prisma.reviewItem.create({
        data: {
          id: review.id,
          batchId: createdBatch.id,
          detectionId: detection.id,
          suggestedMatch: review.suggestedMatch,
          alternateMatches: review.alternateMatches.join("||"),
          reason: review.reason,
          state: "OPEN",
        },
      });
    }
  }
}

async function main() {
  await resetData();
  const cardsByLabel = await seedCatalog();
  await seedBatches(cardsByLabel);
  console.log("Seeded local SQLite data for TCG Listing Platform.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

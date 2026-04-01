import { Jimp } from "jimp";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function getCardCrop(
  image: Jimp,
  scale = 0.72,
  offsetXRatio = 0,
  offsetYRatio = 0,
) {
  const sourceWidth = image.bitmap.width;
  const sourceHeight = image.bitmap.height;
  const targetAspectRatio = 63 / 88;

  let cropHeight = Math.floor(sourceHeight * scale);
  let cropWidth = Math.floor(cropHeight * targetAspectRatio);

  if (cropWidth > sourceWidth) {
    cropWidth = Math.floor(sourceWidth * scale);
    cropHeight = Math.floor(cropWidth / targetAspectRatio);
  }

  cropWidth = Math.max(32, Math.min(sourceWidth, cropWidth));
  cropHeight = Math.max(32, Math.min(sourceHeight, cropHeight));

  const x = Math.max(
    0,
    Math.min(
      sourceWidth - cropWidth,
      Math.floor((sourceWidth - cropWidth) / 2 + sourceWidth * offsetXRatio),
    ),
  );
  const y = Math.max(
    0,
    Math.min(
      sourceHeight - cropHeight,
      Math.floor((sourceHeight - cropHeight) / 2 + sourceHeight * offsetYRatio),
    ),
  );

  return image.clone().crop({ x, y, w: cropWidth, h: cropHeight });
}

function buildCandidateCrops(image: Jimp) {
  return [
    getCardCrop(image, 0.72, 0, 0),
    getCardCrop(image, 0.72, -0.08, 0),
    getCardCrop(image, 0.72, 0.08, 0),
    getCardCrop(image, 0.72, 0, -0.08),
    getCardCrop(image, 0.72, 0, 0.08),
    getCardCrop(image, 0.56, 0, 0),
  ];
}

async function loadImage(source: string) {
  const response = await fetch(source);

  if (!response.ok) {
    throw new Error(`Failed to fetch image source: ${source}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Jimp.read(Buffer.from(arrayBuffer));
}

async function main() {
  const cards = await prisma.catalogCard.findMany({
    where: {
      OR: [
        { imageHashFull: null },
        { imageHashCandidates: null },
      ],
    },
    select: {
      id: true,
      imageLargeUrl: true,
      imageSmallUrl: true,
    },
    take: 500,
  });

  let processed = 0;

  for (const card of cards) {
    const imageUrl = card.imageLargeUrl || card.imageSmallUrl;

    if (!imageUrl) {
      continue;
    }

    try {
      const image = await loadImage(imageUrl);
      const full = image.clone().contain({ w: 256, h: 356 }).hash();
      const candidates = buildCandidateCrops(image).map((crop) => crop.contain({ w: 256, h: 356 }).hash());

      await prisma.catalogCard.update({
        where: { id: card.id },
        data: {
          imageHashFull: full,
          imageHashCandidates: JSON.stringify(candidates),
          syncedAt: new Date(),
        },
      });

      processed += 1;
      if (processed % 25 === 0) {
        console.log(`Backfilled ${processed} catalog card hashes.`);
      }
    } catch (error) {
      console.warn(`Failed to backfill hash for ${card.id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`Finished backfilling ${processed} catalog card hashes.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

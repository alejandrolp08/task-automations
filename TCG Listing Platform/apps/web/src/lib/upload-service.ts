import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { Jimp } from "jimp";
import {
  createSqliteUpload,
  listCatalogRecognitionCards,
  processSqliteUpload,
} from "./sqlite-repository";
import {
  recognizePokemonImageFromCatalog,
  type RecognizedCardCandidate,
} from "./image-recognition";
import { runPaddleOcrOnImages, type OcrImageInput } from "./paddle-ocr";
import { detectMainCardsWithYolo } from "./yolo-card-detector";
import { resolveProjectRoot } from "./project-paths";
import { extractVideoFrames } from "./video-frame-extractor";

const execFile = promisify(execFileCallback);

type SaveUploadInput = {
  batchId: string;
  intakeMode: "video" | "images";
  file: File;
};

type MediaMetadata = {
  durationSeconds?: number;
  imageCount?: number;
  width?: number;
  height?: number;
  mimeType?: string;
};

type StoredUploadInput = {
  batchId: string;
  intakeMode: "video" | "images";
  absoluteFilePath: string;
  originalFileName: string;
};

type ProcessUploadOptions = {
  cropDebugOnly?: boolean;
};

type UploadProcessingMetrics = {
  catalogSize: number;
  extractedFrameCount?: number;
  ocrImageCount: number;
  analyzeMs: number;
  catalogLoadMs: number;
  extractMs: number;
  ocrMs: number;
  recognizeMs: number;
  persistMs: number;
  totalMs: number;
};

type CropBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const CARD_ASPECT_RATIO = 63 / 88;

function logUploadStage(fileName: string, stage: string, details?: string) {
  const suffix = details ? ` ${details}` : "";
  console.log(`[upload:${fileName}] ${stage}${suffix}`);
}

function getCentralCardCropBounds(
  image: Awaited<ReturnType<typeof Jimp.read>>,
  scale = 0.8,
  offsetXRatio = 0,
  offsetYRatio = 0,
) {
  const sourceWidth = image.bitmap.width;
  const sourceHeight = image.bitmap.height;
  const targetAspectRatio = CARD_ASPECT_RATIO;
  const cropHeight = Math.max(160, Math.floor(sourceHeight * scale));
  const cropWidth = Math.max(114, Math.min(sourceWidth, Math.floor(cropHeight * targetAspectRatio)));
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

  return {
    x,
    y,
    w: Math.min(sourceWidth - x, cropWidth),
    h: Math.min(sourceHeight - y, cropHeight),
  };
}

function normalizeDetectedCardBounds(
  image: Awaited<ReturnType<typeof Jimp.read>>,
  bounds: CropBounds,
) {
  const sourceWidth = image.bitmap.width;
  const sourceHeight = image.bitmap.height;
  const paddedWidth = Math.min(sourceWidth, Math.floor(bounds.w * 1.1));
  const paddedHeightFromWidth = Math.floor(paddedWidth / CARD_ASPECT_RATIO);
  const paddedHeight = Math.max(bounds.h, paddedHeightFromWidth);
  const extraHeight = Math.max(0, paddedHeight - bounds.h);
  const extraTop = Math.floor(extraHeight * 0.52 + bounds.h * 0.08);
  const extraBottom = Math.floor(extraHeight * 0.48 + bounds.h * 0.05);
  const sidePadding = Math.floor(bounds.w * 0.06);

  const x = Math.max(0, bounds.x - sidePadding);
  const y = Math.max(0, bounds.y - extraTop);
  const maxWidth = Math.min(sourceWidth - x, paddedWidth + sidePadding * 2);
  const maxHeight = Math.min(sourceHeight - y, bounds.h + extraTop + extraBottom);
  const normalizedHeight = Math.min(maxHeight, Math.floor(maxWidth / CARD_ASPECT_RATIO));
  const normalizedWidth = Math.min(maxWidth, Math.floor(normalizedHeight * CARD_ASPECT_RATIO));

  return {
    x,
    y,
    w: Math.max(80, normalizedWidth),
    h: Math.max(110, normalizedHeight),
  };
}

function getRedChannel(pixelColor: number) {
  return (pixelColor >> 24) & 255;
}

function scoreCardCrop(image: Awaited<ReturnType<typeof Jimp.read>>, bounds: CropBounds) {
  const crop = image.clone().crop(bounds).greyscale().contain({ w: 180, h: 252 });
  const { width, height } = crop.bitmap;
  const borderBand = Math.max(2, Math.floor(Math.min(width, height) * 0.06));
  const innerLeft = borderBand;
  const innerRight = width - borderBand - 1;
  const innerTop = borderBand;
  const innerBottom = height - borderBand - 1;

  let borderSum = 0;
  let borderCount = 0;
  let innerSum = 0;
  let innerCount = 0;
  let edgeEnergy = 0;
  let edgeSamples = 0;
  let verticalEdgeEnergy = 0;
  let horizontalEdgeEnergy = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = getRedChannel(crop.getPixelColor(x, y));
      const right = getRedChannel(crop.getPixelColor(x + 1, y));
      const down = getRedChannel(crop.getPixelColor(x, y + 1));
      const dx = Math.abs(center - right);
      const dy = Math.abs(center - down);
      const gradient = dx + dy;

      if (x < borderBand || x >= width - borderBand || y < borderBand || y >= height - borderBand) {
        borderSum += center;
        borderCount += 1;
      } else {
        innerSum += center;
        innerCount += 1;
      }

      if (
        x >= innerLeft &&
        x <= innerRight &&
        y >= innerTop &&
        y <= innerBottom
      ) {
        edgeEnergy += gradient;
        verticalEdgeEnergy += dx;
        horizontalEdgeEnergy += dy;
        edgeSamples += 1;
      }
    }
  }

  const borderMean = borderCount > 0 ? borderSum / borderCount : 0;
  const innerMean = innerCount > 0 ? innerSum / innerCount : 0;
  const contrastScore = Math.abs(borderMean - innerMean);
  const textureScore = edgeSamples > 0 ? edgeEnergy / edgeSamples : 0;
  const verticalBalance =
    horizontalEdgeEnergy > 0 ? Math.min(1.5, verticalEdgeEnergy / horizontalEdgeEnergy) : 1;
  const areaRatio = (bounds.w * bounds.h) / (image.bitmap.width * image.bitmap.height);
  const sizePenalty = areaRatio > 0.38 ? (areaRatio - 0.38) * 140 : 0;
  const lowerCenterX = Math.abs((bounds.x + bounds.w / 2) / image.bitmap.width - 0.5);
  const lowerCenterY = Math.abs((bounds.y + bounds.h / 2) / image.bitmap.height - 0.62);
  const positionPenalty = lowerCenterX * 40 + lowerCenterY * 55;

  return contrastScore * 0.35 + textureScore * 0.45 + verticalBalance * 14 - sizePenalty - positionPenalty;
}

function getLikelyCardCropBounds(
  image: Awaited<ReturnType<typeof Jimp.read>>,
  mode: "full" | "fast" = "full",
) {
  const scales = mode === "fast" ? [0.38, 0.46, 0.54] : [0.34, 0.38, 0.42, 0.46, 0.5, 0.56];
  const offsetXRatios = mode === "fast" ? [-0.08, 0, 0.08] : [-0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12];
  const offsetYRatios = mode === "fast" ? [0.12, 0.2, 0.28] : [0.08, 0.14, 0.2, 0.26];
  const candidates: CropBounds[] = [];

  for (const scale of scales) {
    for (const offsetXRatio of offsetXRatios) {
      for (const offsetYRatio of offsetYRatios) {
        candidates.push(getCentralCardCropBounds(image, scale, offsetXRatio, offsetYRatio));
      }
    }
  }

  let bestBounds = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreCardCrop(image, candidate);

    if (score > bestScore) {
      bestScore = score;
      bestBounds = candidate;
    }
  }

  return bestBounds;
}

function findPeakIndex(values: number[], start: number, end: number) {
  let bestIndex = start;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (let index = start; index <= end; index += 1) {
    const left = values[index - 1] ?? values[index] ?? 0;
    const center = values[index] ?? 0;
    const right = values[index + 1] ?? values[index] ?? 0;
    const smoothed = left * 0.25 + center * 0.5 + right * 0.25;

    if (smoothed > bestValue) {
      bestValue = smoothed;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function collectPeakCandidates(values: number[], start: number, end: number, limit: number) {
  const peaks: Array<{ index: number; score: number }> = [];

  for (let index = start; index <= end; index += 1) {
    const left = values[index - 1] ?? values[index] ?? 0;
    const center = values[index] ?? 0;
    const right = values[index + 1] ?? values[index] ?? 0;
    const smoothed = left * 0.25 + center * 0.5 + right * 0.25;
    peaks.push({ index, score: smoothed });
  }

  return peaks
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index);
}

function detectVisibleCardFrameBounds(cardCrop: any): CropBounds {
  const analysis = cardCrop.clone().greyscale().contrast(0.55);
  const width = analysis.bitmap.width;
  const height = analysis.bitmap.height;

  if (width < 80 || height < 120) {
    return { x: 0, y: 0, w: width, h: height };
  }

  const verticalScores = new Array<number>(width).fill(0);
  const horizontalScores = new Array<number>(height).fill(0);
  const centerLeft = Math.floor(width * 0.2);
  const centerRight = Math.floor(width * 0.8);
  const centerTop = Math.floor(height * 0.12);
  const centerBottom = Math.floor(height * 0.88);

  for (let x = 1; x < width - 1; x += 1) {
    let score = 0;

    for (let y = centerTop; y < centerBottom; y += 1) {
      const current = getRedChannel(analysis.getPixelColor(x, y));
      const left = getRedChannel(analysis.getPixelColor(x - 1, y));
      const right = getRedChannel(analysis.getPixelColor(x + 1, y));
      score += Math.abs(current - left) + Math.abs(current - right);
    }

    verticalScores[x] = score;
  }

  for (let y = 1; y < height - 1; y += 1) {
    let score = 0;

    for (let x = centerLeft; x < centerRight; x += 1) {
      const current = getRedChannel(analysis.getPixelColor(x, y));
      const up = getRedChannel(analysis.getPixelColor(x, y - 1));
      const down = getRedChannel(analysis.getPixelColor(x, y + 1));
      score += Math.abs(current - up) + Math.abs(current - down);
    }

    horizontalScores[y] = score;
  }

  const left = findPeakIndex(verticalScores, Math.floor(width * 0.01), Math.floor(width * 0.2));
  const right = findPeakIndex(verticalScores, Math.floor(width * 0.78), Math.floor(width * 0.99));
  const top = findPeakIndex(horizontalScores, Math.floor(height * 0.01), Math.floor(height * 0.18));
  const bottom = findPeakIndex(horizontalScores, Math.floor(height * 0.76), Math.floor(height * 0.99));

  const frameX = Math.max(0, left - Math.floor(width * 0.01));
  const frameY = Math.max(0, top - Math.floor(height * 0.006));
  const frameW = Math.max(80, Math.min(width - frameX, right - left + Math.floor(width * 0.02)));
  const frameH = Math.max(110, Math.min(height - frameY, bottom - top + Math.floor(height * 0.015)));

  return {
    x: frameX,
    y: frameY,
    w: frameW,
    h: frameH,
  };
}

function refineVisibleCardBounds(cardCrop: any) {
  const analysis = cardCrop.clone().greyscale().contrast(0.45);
  const width = analysis.bitmap.width;
  const height = analysis.bitmap.height;

  if (width < 80 || height < 120) {
    return {
      x: 0,
      y: 0,
      w: width,
      h: height,
    };
  }

  const verticalScores = new Array<number>(width).fill(0);
  const horizontalScores = new Array<number>(height).fill(0);
  const verticalStartY = Math.max(1, Math.floor(height * 0.05));
  const verticalEndY = Math.max(verticalStartY + 1, Math.floor(height * 0.62));
  const horizontalStartX = Math.max(1, Math.floor(width * 0.08));
  const horizontalEndX = Math.max(horizontalStartX + 1, Math.floor(width * 0.92));

  for (let x = 1; x < width - 1; x += 1) {
    let score = 0;

    for (let y = verticalStartY; y < verticalEndY; y += 1) {
      const current = getRedChannel(analysis.getPixelColor(x, y));
      const left = getRedChannel(analysis.getPixelColor(x - 1, y));
      const right = getRedChannel(analysis.getPixelColor(x + 1, y));
      score += Math.abs(current - left) + Math.abs(current - right);
    }

    verticalScores[x] = score;
  }

  for (let y = 1; y < height - 1; y += 1) {
    let score = 0;

    for (let x = horizontalStartX; x < horizontalEndX; x += 1) {
      const current = getRedChannel(analysis.getPixelColor(x, y));
      const up = getRedChannel(analysis.getPixelColor(x, y - 1));
      const down = getRedChannel(analysis.getPixelColor(x, y + 1));
      score += Math.abs(current - up) + Math.abs(current - down);
    }

    horizontalScores[y] = score;
  }

  const leftCandidates = collectPeakCandidates(
    verticalScores,
    Math.floor(width * 0.02),
    Math.floor(width * 0.42),
    4,
  );
  const rightCandidates = collectPeakCandidates(
    verticalScores,
    Math.floor(width * 0.45),
    Math.floor(width * 0.98),
    4,
  );
  const topCandidates = collectPeakCandidates(
    horizontalScores,
    Math.floor(height * 0.01),
    Math.floor(height * 0.22),
    4,
  );

  let bestBounds: CropBounds = { x: 0, y: 0, w: width, h: height };
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const leftCandidate of leftCandidates) {
    for (const rightCandidate of rightCandidates) {
      const inferredWidth = rightCandidate.index - leftCandidate.index;

      if (inferredWidth < Math.floor(width * 0.28) || inferredWidth > Math.floor(width * 0.92)) {
        continue;
      }

      const inferredHeight = Math.floor((inferredWidth * 88) / 63);

      for (const topCandidate of topCandidates) {
        if (topCandidate.index + inferredHeight > height + Math.floor(height * 0.12)) {
          continue;
        }

        const paddedX = Math.max(0, leftCandidate.index - Math.floor(inferredWidth * 0.02));
        const paddedY = Math.max(0, topCandidate.index - Math.floor(height * 0.015));
        const boundedWidth = Math.min(width - paddedX, Math.floor(inferredWidth * 1.04));
        const boundedHeight = Math.min(height - paddedY, inferredHeight);
        const centerX = (paddedX + boundedWidth / 2) / width;
        const centerY = (paddedY + boundedHeight / 2) / height;
        const edgeScore = leftCandidate.score + rightCandidate.score + topCandidate.score;
        const sizeScore = boundedWidth * boundedHeight * 0.0022;
        const centerPenalty = Math.abs(centerX - 0.46) * 120 + Math.abs(centerY - 0.42) * 90;
        const occlusionPenalty = paddedY + boundedHeight > height ? 50 : 0;
        const totalScore = edgeScore + sizeScore - centerPenalty - occlusionPenalty;

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestBounds = {
            x: paddedX,
            y: paddedY,
            w: Math.max(80, boundedWidth),
            h: Math.max(110, boundedHeight),
          };
        }
      }
    }
  }

  return bestBounds;
}

async function createAdaptiveOcrInputs(
  sourceImagePaths: string[],
  outputDirectory: string,
  label: string,
  mode: "full" | "fast" = "full",
) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const inputs: OcrImageInput[] = [];
  const cleanupPaths: string[] = [];
  const recognitionImagePathBySource = new Map<string, string>();
  const yoloDetections = await detectMainCardsWithYolo(sourceImagePaths).catch(() => []);
  const yoloDetectionsByPath = new Map(yoloDetections.map((detection) => [detection.imagePath, detection]));

  for (const [index, sourceImagePath] of sourceImagePaths.entries()) {
    const image = await Jimp.read(sourceImagePath);
    const yoloDetection = yoloDetectionsByPath.get(sourceImagePath);
    const yoloBounds =
      typeof yoloDetection?.x === "number" &&
      typeof yoloDetection?.y === "number" &&
      typeof yoloDetection?.w === "number" &&
      typeof yoloDetection?.h === "number"
        ? {
            x: Math.max(0, yoloDetection.x),
            y: Math.max(0, yoloDetection.y),
            w: Math.min(image.bitmap.width - Math.max(0, yoloDetection.x), yoloDetection.w),
            h: Math.min(image.bitmap.height - Math.max(0, yoloDetection.y), yoloDetection.h),
          }
        : null;
    const cardBounds = yoloBounds
      ? normalizeDetectedCardBounds(image, yoloBounds)
      : getLikelyCardCropBounds(image, mode);
    const cardCrop = image.clone().crop(cardBounds);
    const visibleCardBounds = yoloBounds
      ? detectVisibleCardFrameBounds(cardCrop)
      : refineVisibleCardBounds(cardCrop);
    const refinedCardCrop = cardCrop.clone().crop(visibleCardBounds);
    const cardWidth = refinedCardCrop.bitmap.width;
    const cardHeight = refinedCardCrop.bitmap.height;
    const topBandHeight = Math.max(64, Math.floor(cardHeight * 0.22));
    const bottomLeftBandHeight = Math.max(38, Math.floor(cardHeight * 0.14));
    const bottomWideBandHeight = Math.max(46, Math.floor(cardHeight * 0.18));
    const topCrop = refinedCardCrop
      .clone()
      .crop({
        x: Math.floor(cardWidth * 0.005),
        y: 0,
        w: Math.max(64, Math.floor(cardWidth * 0.99)),
        h: topBandHeight,
      })
      .scaleToFit({ w: 1200, h: 320 });
    const topContrastCrop = topCrop.clone().greyscale().contrast(0.9);
    const bottomCrop = refinedCardCrop
      .clone()
      .crop({
        x: Math.floor(cardWidth * 0.01),
        y: Math.max(0, Math.floor(cardHeight * 0.81)),
        w: Math.max(64, Math.floor(cardWidth * 0.58)),
        h: bottomLeftBandHeight,
      })
      .scaleToFit({ w: 1200, h: 280 });
    const bottomWideCrop = refinedCardCrop
      .clone()
      .crop({
        x: Math.floor(cardWidth * 0.01),
        y: Math.max(0, Math.floor(cardHeight * 0.79)),
        w: Math.max(80, Math.floor(cardWidth * 0.78)),
        h: bottomWideBandHeight,
      })
      .scaleToFit({ w: 1400, h: 320 });
    const bottomContrastCrop = bottomWideCrop.clone().greyscale().contrast(0.8);
    const bottomBinaryCrop = bottomWideCrop
      .clone()
      .greyscale()
      .contrast(0.98)
      .posterize(3);
    const cardPath = path.join(outputDirectory, `${label}-${String(index + 1).padStart(3, "0")}-card.png`);
    const topPath = path.join(outputDirectory, `${label}-${String(index + 1).padStart(3, "0")}-top.png`);
    const topContrastPath = path.join(
      outputDirectory,
      `${label}-${String(index + 1).padStart(3, "0")}-top-contrast.png`,
    );
    const bottomPath = path.join(outputDirectory, `${label}-${String(index + 1).padStart(3, "0")}-bottom.png`);
    const bottomContrastPath = path.join(
      outputDirectory,
      `${label}-${String(index + 1).padStart(3, "0")}-bottom-contrast.png`,
    );
    const bottomBinaryPath = path.join(
      outputDirectory,
      `${label}-${String(index + 1).padStart(3, "0")}-bottom-binary.png`,
    );

    await refinedCardCrop.write(cardPath as `${string}.${string}`);
    await topCrop.write(topPath as `${string}.${string}`);
    await topContrastCrop.write(topContrastPath as `${string}.${string}`);
    await bottomCrop.write(bottomPath as `${string}.${string}`);
    await bottomContrastCrop.write(bottomContrastPath as `${string}.${string}`);
    await bottomBinaryCrop.write(bottomBinaryPath as `${string}.${string}`);
    recognitionImagePathBySource.set(sourceImagePath, cardPath);
    cleanupPaths.push(topContrastPath, bottomContrastPath, bottomBinaryPath);
    inputs.push(
      {
        imagePath: topPath,
        sourceImagePath,
        region: "top",
      },
      {
        imagePath: topContrastPath,
        sourceImagePath,
        region: "top",
      },
      {
        imagePath: bottomPath,
        sourceImagePath,
        region: "bottom",
      },
      {
        imagePath: bottomContrastPath,
        sourceImagePath,
        region: "bottom",
      },
      {
        imagePath: bottomBinaryPath,
        sourceImagePath,
        region: "bottom",
      },
    );
  }

  return {
    inputs,
    cleanupPaths,
    recognitionImagePathBySource,
  };
}

function dedupeRecognizedCards(cards: RecognizedCardCandidate[]) {
  const grouped = new Map<string, RecognizedCardCandidate>();

  for (const card of cards) {
    const key = `${card.sourceLabel ?? "unknown-source"}::${card.cardName}::${card.setName}::${card.cardNumber}`;
    const current = grouped.get(key);

    if (!current || card.confidence > current.confidence) {
      grouped.set(key, card);
    }
  }

  return Array.from(grouped.values()).sort((left, right) => right.confidence - left.confidence);
}

function normalizeMatchLookupValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildMatchLabel(cardName: string, cardNumber: string) {
  return `${cardName} ${cardNumber}`.trim();
}

function parseMatchLabel(match: string) {
  const trimmed = match.trim();
  const parts = trimmed.split(" ");
  const cardNumber = parts.pop() ?? "";
  const cardName = parts.join(" ").trim();

  return {
    cardName,
    normalizedCardName: normalizeMatchLookupValue(cardName),
    cardNumber,
    label: buildMatchLabel(cardName, cardNumber),
  };
}

function hasAnyOcrHints(card: RecognizedCardCandidate) {
  return (card.notes ?? "").includes("OCR hints:");
}

function hasReliableCollectorHint(card: RecognizedCardCandidate) {
  const notes = card.notes ?? "";
  return /OCR hints:\s*[^.]*\d{2,4}/i.test(notes);
}

function classifyFrameStability(card: RecognizedCardCandidate) {
  const normalizedName = normalizeMatchLookupValue(card.cardName);

  if (normalizedName === "unknown" || normalizedName === "unknown card") {
    return "transition" as const;
  }

  if (isHashOnlyFallbackCard(card) && card.confidence < 0.62) {
    return "transition" as const;
  }

  if (!hasAnyOcrHints(card) && card.confidence < 0.55) {
    return "transition" as const;
  }

  if (card.confidence >= 0.82 || hasReliableCollectorHint(card)) {
    return "stable" as const;
  }

  return "weak" as const;
}

function segmentStableCardFrames(cards: RecognizedCardCandidate[]) {
  const sorted = [...cards].sort((left, right) => parseFrameOrder(left.sourceLabel) - parseFrameOrder(right.sourceLabel));
  const groups: RecognizedCardCandidate[][] = [];

  for (const card of sorted) {
    const frameState = classifyFrameStability(card);

    if (frameState === "transition") {
      continue;
    }

    const previousGroup = groups[groups.length - 1];
    const previousCard = previousGroup?.[previousGroup.length - 1];

    if (!previousCard) {
      groups.push([card]);
      continue;
    }

    const frameGap = parseFrameOrder(card.sourceLabel) - parseFrameOrder(previousCard.sourceLabel);
    const previousState = classifyFrameStability(previousCard);
    const currentLabel = buildMatchLabel(card.cardName, card.cardNumber);
    const previousLabel = buildMatchLabel(previousCard.cardName, previousCard.cardNumber);
    const samePokemon = normalizeMatchLookupValue(card.cardName) === normalizeMatchLookupValue(previousCard.cardName);

    if (
      frameGap <= 1 &&
      (
        currentLabel === previousLabel ||
        (samePokemon && previousState !== "stable" && frameState !== "stable")
      )
    ) {
      previousGroup.push(card);
      continue;
    }

    groups.push([card]);
  }

  return groups.map((group) => {
    if (group.length === 1) {
      return group[0];
    }

    const stableCards = group.filter((card) => classifyFrameStability(card) === "stable");
    const pool = stableCards.length > 0 ? stableCards : group;
    const bestCard = [...pool].sort((left, right) => right.confidence - left.confidence)[0];

    return {
      ...bestCard,
      status: "NEEDS_REVIEW" as const,
      notes: `${bestCard.notes ?? ""} Selected as representative frame for a stable card segment of ${group.length} frames.`.trim(),
      review: bestCard.review,
    };
  });
}

function applyCrossFrameConsensus(cards: RecognizedCardCandidate[]): RecognizedCardCandidate[] {
  const sorted = [...cards].sort((left, right) => parseFrameOrder(left.sourceLabel) - parseFrameOrder(right.sourceLabel));
  const grouped = new Map<string, RecognizedCardCandidate[]>();

  for (const card of sorted) {
    const key = normalizeMatchLookupValue(card.cardName);
    if (key === "unknown" || key === "unknown card") {
      continue;
    }
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)?.push(card);
  }

  return sorted.map((card) => {
    const key = normalizeMatchLookupValue(card.cardName);
    if (key === "unknown" || key === "unknown card") {
      return card;
    }
    const siblings = (grouped.get(key) ?? []).filter(
      (candidate) =>
        Math.abs(parseFrameOrder(candidate.sourceLabel) - parseFrameOrder(card.sourceLabel)) <= 3,
    );

    if (siblings.length < 2) {
      return card;
    }

    const sameNameDifferentVariants = new Set(
      siblings.map((entry) => buildMatchLabel(entry.cardName, entry.cardNumber)),
    );

    if (sameNameDifferentVariants.size < 2) {
      return card;
    }

    const variantScores = new Map<string, number>();

    for (const sibling of siblings) {
      const suggestedLabel = buildMatchLabel(sibling.cardName, sibling.cardNumber);
      variantScores.set(
        suggestedLabel,
        (variantScores.get(suggestedLabel) ?? 0) + sibling.confidence * 2.2,
      );

      for (const [alternateIndex, alternateMatch] of (sibling.review?.alternateMatches ?? []).entries()) {
        const weight = Math.max(0.2, 0.9 - alternateIndex * 0.2);
        variantScores.set(
          alternateMatch,
          (variantScores.get(alternateMatch) ?? 0) + weight,
        );
      }
    }

    const consensus = Array.from(variantScores.entries())
      .sort((left, right) => right[1] - left[1]);

    const topConsensus = consensus[0];
    const secondConsensus = consensus[1];

    if (!topConsensus) {
      return card;
    }

    const parsedConsensus = parseMatchLabel(topConsensus[0]);
    const currentLabel = buildMatchLabel(card.cardName, card.cardNumber);
    const currentScore = variantScores.get(currentLabel) ?? 0;
    const consensusMargin = topConsensus[1] - (secondConsensus?.[1] ?? 0);
    const supportingSiblings = siblings.filter(
      (sibling) => buildMatchLabel(sibling.cardName, sibling.cardNumber) === parsedConsensus.label,
    ).length;

    if (
      parsedConsensus.label === currentLabel ||
      supportingSiblings < 2 ||
      topConsensus[1] < currentScore + 0.85 ||
      consensusMargin < 0.55 ||
      card.confidence >= 0.82
    ) {
      return card;
    }

    const alternateMatches = Array.from(
      new Set(
        [
          currentLabel,
          ...(card.review?.alternateMatches ?? []),
        ].filter((match) => match !== parsedConsensus.label),
      ),
    ).slice(0, 4);

    return {
      ...card,
      cardName: parsedConsensus.cardName,
      cardNumber: parsedConsensus.cardNumber,
      status: "NEEDS_REVIEW" as const,
      notes: `${card.notes ?? ""} Cross-frame consensus favored ${parsedConsensus.label}.`.trim(),
      review: {
        suggestedMatch: parsedConsensus.label,
        alternateMatches,
        reason:
          "Multiple frames in the same video point to this Pokemon, so the batch is favoring one shared variant until you confirm the exact card.",
      },
    };
  });
}

function parseFrameOrder(sourceLabel?: string) {
  if (!sourceLabel) {
    return Number.MAX_SAFE_INTEGER;
  }

  const match = sourceLabel.match(/Frame\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function buildRepresentativeReview(cards: RecognizedCardCandidate[]) {
  const suggestedCount = new Map<string, number>();
  const alternateCount = new Map<string, number>();

  for (const card of cards) {
    const suggested = card.review?.suggestedMatch ?? buildMatchLabel(card.cardName, card.cardNumber);
    suggestedCount.set(suggested, (suggestedCount.get(suggested) ?? 0) + 1);

    for (const [index, alternate] of (card.review?.alternateMatches ?? []).entries()) {
      const weight = Math.max(1, 4 - index);
      alternateCount.set(alternate, (alternateCount.get(alternate) ?? 0) + weight);
    }
  }

  const rankedAlternates = Array.from(alternateCount.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([label]) => label);

  const topSuggested = Array.from(suggestedCount.entries()).sort((left, right) => right[1] - left[1])[0]?.[0];

  return {
    suggestedMatch: topSuggested,
    alternateMatches: rankedAlternates,
  };
}

function isHashOnlyFallbackCard(card: RecognizedCardCandidate) {
  return (card.notes ?? "").includes("OCR fallback used local visual hashes only.");
}

function degradeIsolatedHashFallbacks(cards: RecognizedCardCandidate[]) {
  const sorted = [...cards].sort((left, right) => parseFrameOrder(left.sourceLabel) - parseFrameOrder(right.sourceLabel));

  return sorted.map((card, index) => {
    if (!isHashOnlyFallbackCard(card)) {
      return card;
    }

    const currentLabel = buildMatchLabel(card.cardName, card.cardNumber);
    const hasNearbySupport = sorted.some((candidate, candidateIndex) => {
      if (candidateIndex === index) {
        return false;
      }

      const frameGap = Math.abs(parseFrameOrder(candidate.sourceLabel) - parseFrameOrder(card.sourceLabel));
      if (frameGap > 2) {
        return false;
      }

      const candidateLabel = buildMatchLabel(candidate.cardName, candidate.cardNumber);
      return candidateLabel === currentLabel && candidate.confidence >= 0.68;
    });

    if (hasNearbySupport || card.confidence >= 0.62) {
      return card;
    }

    return {
      sourceLabel: card.sourceLabel,
      cardName: "Unknown Card",
      setName: "Unknown Set",
      cardNumber: "000",
      rarity: "Unknown",
      confidence: 0,
      status: "NEEDS_REVIEW" as const,
      notes:
        "Visual-only fallback found an isolated low-confidence match, so this frame was returned to manual review.",
      review: {
        suggestedMatch: "Unknown Card 000",
        alternateMatches: [currentLabel],
        reason:
          "This frame only had a weak visual-only match without nearby support from adjacent frames.",
      },
    };
  });
}

function fillUnknownFramesFromNeighbors(cards: RecognizedCardCandidate[]) {
  const sorted = [...cards].sort((left, right) => parseFrameOrder(left.sourceLabel) - parseFrameOrder(right.sourceLabel));

  return sorted.map((card, index) => {
    const normalizedName = normalizeMatchLookupValue(card.cardName);

    if (normalizedName !== "unknown" && normalizedName !== "unknown card") {
      return card;
    }

    const previous = sorted[index - 1];
    const next = sorted[index + 1];

    if (!previous || !next) {
      return card;
    }

    const previousLabel = buildMatchLabel(previous.cardName, previous.cardNumber);
    const nextLabel = buildMatchLabel(next.cardName, next.cardNumber);
    const isPreviousKnown = normalizeMatchLookupValue(previous.cardName) !== "unknown" && normalizeMatchLookupValue(previous.cardName) !== "unknown card";
    const isNextKnown = normalizeMatchLookupValue(next.cardName) !== "unknown" && normalizeMatchLookupValue(next.cardName) !== "unknown card";
    const previousGap = parseFrameOrder(card.sourceLabel) - parseFrameOrder(previous.sourceLabel);
    const nextGap = parseFrameOrder(next.sourceLabel) - parseFrameOrder(card.sourceLabel);

    if (
      !isPreviousKnown ||
      !isNextKnown ||
      previousLabel !== nextLabel ||
      previousGap > 2 ||
      nextGap > 2 ||
      previous.confidence < 0.72 ||
      next.confidence < 0.72
    ) {
      return card;
    }

    return {
      ...card,
      cardName: previous.cardName,
      setName: previous.setName,
      cardNumber: previous.cardNumber,
      rarity: previous.rarity,
      confidence: Number(Math.max(0.58, Math.min(previous.confidence, next.confidence) - 0.08).toFixed(2)),
      status: "NEEDS_REVIEW" as const,
      notes: "Filled from adjacent frames that agreed on the same card while this frame was too blurry to read cleanly.",
      review: {
        suggestedMatch: previousLabel,
        alternateMatches: Array.from(
          new Set([
            ...(previous.review?.alternateMatches ?? []),
            ...(next.review?.alternateMatches ?? []),
          ].filter((match) => match !== previousLabel)),
        ).slice(0, 4),
        reason:
          "Adjacent frames agree on this same card, so this blurry frame inherited the likely match for review.",
      },
    };
  });
}

function isStableSequentialExactMatch(cards: RecognizedCardCandidate[], bestCard: RecognizedCardCandidate) {
  const exactLabels = new Set(cards.map((card) => buildMatchLabel(card.cardName, card.cardNumber)));

  if (exactLabels.size !== 1) {
    return false;
  }

  if (bestCard.status !== "MATCHED" || bestCard.confidence < 0.78) {
    return false;
  }

  const supportingFrames = cards.filter(
    (card) =>
      buildMatchLabel(card.cardName, card.cardNumber) === buildMatchLabel(bestCard.cardName, bestCard.cardNumber) &&
      card.confidence >= 0.55,
  );

  return supportingFrames.length >= 2;
}

function shouldMergeSequentialCards(previousCard: RecognizedCardCandidate, currentCard: RecognizedCardCandidate) {
  const frameGap = parseFrameOrder(currentCard.sourceLabel) - parseFrameOrder(previousCard.sourceLabel);

  if (frameGap > 1) {
    return false;
  }

  const previousLabel = buildMatchLabel(previousCard.cardName, previousCard.cardNumber);
  const currentLabel = buildMatchLabel(currentCard.cardName, currentCard.cardNumber);

  if (previousLabel === currentLabel) {
    return true;
  }

  const previousName = normalizeMatchLookupValue(previousCard.cardName);
  const currentName = normalizeMatchLookupValue(currentCard.cardName);

  if (previousName !== currentName) {
    return false;
  }

  const previousSuggested = previousCard.review?.suggestedMatch;
  const currentSuggested = currentCard.review?.suggestedMatch;

  if (!previousSuggested || !currentSuggested || previousSuggested !== currentSuggested) {
    return false;
  }

  return previousCard.confidence >= 0.86 && currentCard.confidence >= 0.86;
}

function collapseSequentialSameCardFrames(cards: RecognizedCardCandidate[]) {
  const sorted = [...cards].sort((left, right) => parseFrameOrder(left.sourceLabel) - parseFrameOrder(right.sourceLabel));
  const groups: RecognizedCardCandidate[][] = [];

  for (const card of sorted) {
    const currentName = normalizeMatchLookupValue(card.cardName);
    if (currentName === "unknown" || currentName === "unknown card") {
      groups.push([card]);
      continue;
    }
    const previousGroup = groups[groups.length - 1];
    const previousCard = previousGroup?.[previousGroup.length - 1];

    if (!previousCard) {
      groups.push([card]);
      continue;
    }

    if (shouldMergeSequentialCards(previousCard, card)) {
      previousGroup.push(card);
      continue;
    }

    groups.push([card]);
  }

  return groups.map((group) => {
    if (group.length === 1) {
      return group[0];
    }

    const bestCard = [...group].sort((left, right) => right.confidence - left.confidence)[0];

    if (isStableSequentialExactMatch(group, bestCard)) {
      return {
        ...bestCard,
        notes: `${bestCard.notes ?? ""} Consolidated ${group.length} adjacent frames with the same exact card match.`.trim(),
      };
    }

    const mergedReview = buildRepresentativeReview(group);
    const alternateMatches = mergedReview.alternateMatches
      .filter((match) => match !== mergedReview.suggestedMatch)
      .slice(0, 4);

    return {
      ...bestCard,
      status: "NEEDS_REVIEW" as const,
      notes: `${bestCard.notes ?? ""} Consolidated ${group.length} adjacent frames for the same Pokemon into one review item.`.trim(),
      review: mergedReview.suggestedMatch
        ? {
            suggestedMatch: mergedReview.suggestedMatch,
            alternateMatches,
            reason:
              "Multiple adjacent frames appear to show the same card, so this review item is using one representative frame with merged match options.",
          }
        : bestCard.review,
    };
  });
}

async function readMacMetadata(filePath: string) {
  try {
    const { stdout } = await execFile("mdls", [
      "-name",
      "kMDItemContentType",
      "-name",
      "kMDItemDurationSeconds",
      "-json",
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as Array<{
      kMDItemContentType?: string;
      kMDItemDurationSeconds?: number;
    }>;
    return parsed[0] ?? {};
  } catch {
    return {};
  }
}

async function readImageDimensions(filePath: string) {
  try {
    const { stdout } = await execFile("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath]);
    const widthMatch = stdout.match(/pixelWidth:\s+(\d+)/);
    const heightMatch = stdout.match(/pixelHeight:\s+(\d+)/);

    return {
      width: widthMatch ? Number.parseInt(widthMatch[1], 10) : undefined,
      height: heightMatch ? Number.parseInt(heightMatch[1], 10) : undefined,
    };
  } catch {
    return {};
  }
}

async function analyzeStoredMedia(filePath: string, intakeMode: "video" | "images"): Promise<MediaMetadata> {
  const metadata = await readMacMetadata(filePath);

  if (intakeMode === "video") {
    return {
      durationSeconds:
        typeof metadata.kMDItemDurationSeconds === "number"
          ? Math.max(1, Math.round(metadata.kMDItemDurationSeconds))
          : undefined,
      mimeType: metadata.kMDItemContentType,
    };
  }

  const dimensions = await readImageDimensions(filePath);

  return {
    imageCount: 1,
    width: dimensions.width,
    height: dimensions.height,
    mimeType: metadata.kMDItemContentType,
  };
}

async function processStoredBatchUpload(input: StoredUploadInput, options?: ProcessUploadOptions) {
  const projectRoot = resolveProjectRoot();
  const startedAt = Date.now();
  logUploadStage(input.originalFileName, "start", `mode=${input.intakeMode}`);
  const mediaMetadata = await analyzeStoredMedia(input.absoluteFilePath, input.intakeMode);
  const analyzeCompletedAt = Date.now();
  logUploadStage(
    input.originalFileName,
    "analyzed",
    `ms=${analyzeCompletedAt - startedAt} duration=${mediaMetadata.durationSeconds ?? 0}s`,
  );
  const catalogCards = await listCatalogRecognitionCards();
  const catalogLoadedAt = Date.now();
  logUploadStage(
    input.originalFileName,
    "catalog-loaded",
    `ms=${catalogLoadedAt - analyzeCompletedAt} cards=${catalogCards.length}`,
  );
  const uploadDirectory = path.dirname(input.absoluteFilePath);
  const storedFileName = path.basename(input.absoluteFilePath);
  let extractedFrameCount: number | undefined;
  let ocrImageCount = 0;
  let extractCompletedAt = catalogLoadedAt;
  let ocrCompletedAt = catalogLoadedAt;
  let recognizeCompletedAt = catalogLoadedAt;
  let ocrCleanupPaths: string[] = [];

  const recognizedCards =
    input.intakeMode === "images"
      ? await (async () => {
          extractCompletedAt = Date.now();
          logUploadStage(input.originalFileName, "extract-skip", "single-image upload");
          const ocrPrepDirectory = path.join(uploadDirectory, `${path.parse(storedFileName).name}-ocr`);
          const ocrPrepared = await createAdaptiveOcrInputs(
            [input.absoluteFilePath],
            ocrPrepDirectory,
            "image",
            options?.cropDebugOnly ? "fast" : "full",
          );
          ocrCleanupPaths = ocrPrepared.cleanupPaths;
          if (options?.cropDebugOnly) {
            ocrImageCount = ocrPrepared.inputs.length;
            ocrCompletedAt = Date.now();
            recognizeCompletedAt = ocrCompletedAt;
            logUploadStage(input.originalFileName, "crop-debug-only", "skipping OCR and recognition");
            return [];
          }
          const [ocrResult] = await runPaddleOcrOnImages(ocrPrepared.inputs);
          ocrImageCount = ocrPrepared.inputs.length;
          ocrCompletedAt = Date.now();
          logUploadStage(input.originalFileName, "ocr-complete", `ms=${ocrCompletedAt - extractCompletedAt} images=1`);
          const matches = await recognizePokemonImageFromCatalog(
            ocrPrepared.recognitionImagePathBySource.get(input.absoluteFilePath) ?? input.absoluteFilePath,
            input.originalFileName,
            catalogCards,
            ocrResult,
            { allowFullCatalogFallback: true },
          );
          recognizeCompletedAt = Date.now();
          logUploadStage(
            input.originalFileName,
            "recognize-complete",
            `ms=${recognizeCompletedAt - ocrCompletedAt} matches=${matches.length}`,
          );
          return matches;
        })()
      : await (async () => {
          logUploadStage(input.originalFileName, "extract-start");
          const framesDirectory = path.join(uploadDirectory, `${path.parse(storedFileName).name}-frames`);
          const extraction = await extractVideoFrames(
            input.absoluteFilePath,
            framesDirectory,
            mediaMetadata.durationSeconds,
          );
          extractedFrameCount = extraction.frames.length;
          extractCompletedAt = Date.now();
          logUploadStage(
            input.originalFileName,
            "extract-complete",
            `ms=${extractCompletedAt - catalogLoadedAt} frames=${extractedFrameCount}`,
          );
          logUploadStage(input.originalFileName, "ocr-start", `images=${extraction.frames.length}`);
          const ocrPrepDirectory = path.join(uploadDirectory, `${path.parse(storedFileName).name}-ocr`);
          const ocrPrepared = await createAdaptiveOcrInputs(
            extraction.frames,
            ocrPrepDirectory,
            "frame",
            options?.cropDebugOnly ? "fast" : "full",
          );
          ocrCleanupPaths = ocrPrepared.cleanupPaths;
          if (options?.cropDebugOnly) {
            ocrImageCount = ocrPrepared.inputs.length;
            ocrCompletedAt = Date.now();
            recognizeCompletedAt = ocrCompletedAt;
            logUploadStage(input.originalFileName, "crop-debug-only", `generated=${ocrImageCount} OCR crops`);
            return [];
          }
          const ocrResults = await runPaddleOcrOnImages(ocrPrepared.inputs);
          ocrImageCount = ocrPrepared.inputs.length;
          ocrCompletedAt = Date.now();
          logUploadStage(input.originalFileName, "ocr-complete", `ms=${ocrCompletedAt - extractCompletedAt} images=${ocrImageCount}`);
          const ocrResultsByPath = new Map(ocrResults.map((result) => [result.imagePath, result]));
          logUploadStage(input.originalFileName, "recognize-start", `frames=${extraction.frames.length}`);
          const frameRecognitions = await Promise.all(
            extraction.frames.map((framePath, index) =>
              recognizePokemonImageFromCatalog(
                ocrPrepared.recognitionImagePathBySource.get(framePath) ?? framePath,
                `${input.originalFileName}-frame-${String(index + 1).padStart(3, "0")}`,
                catalogCards,
                ocrResultsByPath.get(framePath),
                { allowFullCatalogFallback: false, allowHashOnlyFallbackWithoutHints: true },
              ).then((matches) => {
                const sourceLabel = `Frame ${String(index + 1).padStart(3, "0")}`;
                if (matches.length > 0) {
                  return matches.map((match) => ({
                    ...match,
                    sourceLabel,
                  }));
                }

                return [
                  {
                    sourceLabel,
                    cardName: "Unknown Card",
                    setName: "Unknown Set",
                    cardNumber: "000",
                    rarity: "Unknown",
                    confidence: 0,
                    status: "NEEDS_REVIEW",
                    notes: "OCR did not produce a usable match for this frame.",
                    review: {
                      suggestedMatch: "Unknown Card 000",
                      alternateMatches: [],
                      reason: "We could not confidently read this card. Please pick the correct match manually.",
                    },
                  } satisfies RecognizedCardCandidate,
                ];
              }),
            ),
          );
          recognizeCompletedAt = Date.now();
          logUploadStage(
            input.originalFileName,
            "recognize-complete",
            `ms=${recognizeCompletedAt - ocrCompletedAt} candidates=${frameRecognitions.flat().length}`,
          );
          return dedupeRecognizedCards(
            segmentStableCardFrames(
              collapseSequentialSameCardFrames(
                applyCrossFrameConsensus(
                  fillUnknownFramesFromNeighbors(
                    degradeIsolatedHashFallbacks(frameRecognitions.flat()),
                  ),
                ),
              ),
            ),
          );
        })();

  await Promise.all(ocrCleanupPaths.map((cleanupPath) => fs.rm(cleanupPath, { force: true })));

  const derivedImageCount =
    input.intakeMode === "images"
      ? mediaMetadata.imageCount
      : await (async () => {
          const framesDirectory = path.join(uploadDirectory, `${path.parse(storedFileName).name}-frames`);
          try {
            return (await fs.readdir(framesDirectory)).filter((entry) => entry.endsWith(".png")).length;
          } catch {
            return recognizedCards.length;
          }
        })();

  const uploadId = await createSqliteUpload({
    batchId: input.batchId,
    fileName: input.originalFileName,
    storageKey: path.relative(projectRoot, input.absoluteFilePath),
    kind: input.intakeMode,
    durationSeconds: mediaMetadata.durationSeconds,
    imageCount: derivedImageCount,
  });

  const processingResult = await processSqliteUpload(input.batchId, uploadId, input.intakeMode, {
    originalFileName: input.originalFileName,
    durationSeconds: mediaMetadata.durationSeconds,
    imageCount: mediaMetadata.imageCount,
    width: mediaMetadata.width,
    height: mediaMetadata.height,
    mimeType: mediaMetadata.mimeType,
    recognizedCards,
  });
  const completedAt = Date.now();
  logUploadStage(
    input.originalFileName,
    "persist-complete",
    `ms=${completedAt - recognizeCompletedAt} detections=${processingResult.detectionsAdded} reviews=${processingResult.reviewCountAdded}`,
  );

  const metrics: UploadProcessingMetrics = {
    catalogSize: catalogCards.length,
    extractedFrameCount,
    ocrImageCount,
    analyzeMs: analyzeCompletedAt - startedAt,
    catalogLoadMs: catalogLoadedAt - analyzeCompletedAt,
    extractMs: extractCompletedAt - catalogLoadedAt,
    ocrMs: ocrCompletedAt - extractCompletedAt,
    recognizeMs: recognizeCompletedAt - ocrCompletedAt,
    persistMs: completedAt - recognizeCompletedAt,
    totalMs: completedAt - startedAt,
  };

  return {
    uploadId,
    storageKey: path.relative(projectRoot, input.absoluteFilePath),
    mediaMetadata,
    processingResult,
    metrics,
  };
}

export async function saveBatchUpload(input: SaveUploadInput) {
  const projectRoot = resolveProjectRoot();
  const arrayBuffer = await input.file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const extension = path.extname(input.file.name) || (input.intakeMode === "video" ? ".mp4" : ".jpg");
  const uploadDirectory = path.join(projectRoot, "data", "uploads", input.batchId);
  const storedFileName = `${crypto.randomUUID()}${extension}`;

  await fs.mkdir(uploadDirectory, { recursive: true });
  const absoluteFilePath = path.join(uploadDirectory, storedFileName);
  await fs.writeFile(absoluteFilePath, buffer);
  return processStoredBatchUpload({
    batchId: input.batchId,
    intakeMode: input.intakeMode,
    absoluteFilePath,
    originalFileName: input.file.name,
  });
}

export async function importExistingUploadFromPath(input: StoredUploadInput, options?: ProcessUploadOptions) {
  if (!fsSync.existsSync(input.absoluteFilePath)) {
    throw new Error(`File not found: ${input.absoluteFilePath}`);
  }

  return processStoredBatchUpload(input, options);
}

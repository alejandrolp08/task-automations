import { Jimp, compareHashes } from "jimp";
import type { CatalogRecognitionCard } from "./sqlite-repository";
import type { CardOcrResult } from "./paddle-ocr";

export type RecognizedCardCandidate = {
  sourceLabel?: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  rarity: string;
  confidence: number;
  status: "MATCHED" | "NEEDS_REVIEW";
  notes?: string;
  review?: {
    suggestedMatch: string;
    alternateMatches: string[];
    reason: string;
  };
};

const hashCache = new Map<string, string>();

type PreparedHashes = {
  full: string;
  candidates: string[];
  artBox: string;
  footerLeft: string;
  nameBar: string;
};

type OcrHints = {
  collectorNumbers: string[];
  topTextCandidates: string[];
  setCodeCandidates: string[];
};

type RecognitionOptions = {
  allowFullCatalogFallback?: boolean;
  allowHashOnlyFallbackWithoutHints?: boolean;
};

const OCR_STOPWORDS = new Set([
  "pokemon",
  "trainer",
  "basic",
  "stage",
  "card",
  "energy",
  "your",
  "this",
]);

const OCR_SET_STOPWORDS = new Set([
  "hp",
  "ex",
  "gx",
  "vmx",
  "vmax",
  "vstar",
  "basic",
  "stage",
]);

function logRecognitionStage(fileName: string, message: string) {
  console.log(`[recognize:${fileName}] ${message}`);
}

function normalizeLookupValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeCollectorNumber(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9/]+/g, "");
}

function normalizeSetCode(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function computeEditDistance(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  const previous = new Array<number>(right.length + 1).fill(0).map((_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost,
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length];
}

function isFuzzyNameMatch(candidate: string, normalizedCardName: string) {
  const compactCandidate = candidate.replace(/\s+/g, "");
  const compactCardName = normalizedCardName.replace(/\s+/g, "");
  const maxDistance = compactCardName.length >= 8 ? 2 : 1;
  return computeEditDistance(compactCandidate, compactCardName) <= maxDistance;
}

function buildFuzzyNameScore(candidate: string, normalizedCardName: string) {
  const compactCandidate = candidate.replace(/\s+/g, "");
  const compactCardName = normalizedCardName.replace(/\s+/g, "");
  const distance = computeEditDistance(compactCandidate, compactCardName);
  const maxLength = Math.max(compactCandidate.length, compactCardName.length, 1);
  return Math.max(0, 1 - distance / maxLength);
}

function extractCollectorNumberCandidates(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, "").replace(/[|\\]/g, "/");
  const candidates = new Set<string>();
  const patterns = [
    /\b[a-z]{0,3}\d{1,3}\/[a-z]{0,3}\d{1,3}\b/g,
    /\b[a-z]{0,5}\d{1,3}\b/g,
    /\b\d{2,4}\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const candidate = normalizeCollectorNumber(match[0]);
      if (isReliableCollectorNumberCandidate(candidate)) {
        candidates.add(candidate);
      }
    }
  }

  return Array.from(candidates);
}

function extractSetCodeCandidates(value: string) {
  const normalized = normalizeLookupValue(value);
  const tokens = normalized
    .split(" ")
    .map((token) => normalizeSetCode(token))
    .filter((token) => isReliableSetCodeCandidate(token) && !OCR_SET_STOPWORDS.has(token));

  return Array.from(new Set(tokens));
}

function isReliableCollectorSegment(segment: string) {
  if (/^\d{2,4}$/.test(segment)) {
    return true;
  }

  return /^(?:[a-z]{2,5}\d{1,3})$/.test(segment);
}

function isReliableCollectorNumberCandidate(candidate: string) {
  if (!candidate || candidate.length < 2) {
    return false;
  }

  const segments = candidate.split("/");

  if (segments.length > 2) {
    return false;
  }

  if (segments.some((segment) => !isReliableCollectorSegment(segment))) {
    return false;
  }

  const digitCount = candidate.replace(/[^0-9]/g, "").length;
  return digitCount >= 2;
}

function isReliableSetCodeCandidate(candidate: string) {
  if (candidate.length < 3 || candidate.length > 6) {
    return false;
  }

  if (!/^[a-z0-9]+$/.test(candidate)) {
    return false;
  }

  if (/\d/.test(candidate)) {
    return true;
  }

  return /^(sv|swsh|sm|xy|bw|dp|pl|hgss|ex|neo)$/i.test(candidate);
}

function isStrongNameCandidate(value: string) {
  const normalized = normalizeLookupValue(value);

  if (normalized.length < 5) {
    return false;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.some((token) => token.length >= 5);
}

async function loadImage(source: string) {
  return source.startsWith("http://") || source.startsWith("https://")
    ? await (async () => {
        const response = await fetch(source);

        if (!response.ok) {
          throw new Error(`Failed to fetch image hash source: ${source}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Jimp.read(Buffer.from(arrayBuffer));
      })()
    : await Jimp.read(source);
}

function getCardCrop(
  image: Awaited<ReturnType<typeof loadImage>>,
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

function buildCandidateCrops(image: Awaited<ReturnType<typeof loadImage>>) {
  return [
    getCardCrop(image, 0.72, 0, 0),
    getCardCrop(image, 0.72, -0.08, 0),
    getCardCrop(image, 0.72, 0.08, 0),
    getCardCrop(image, 0.72, 0, -0.08),
    getCardCrop(image, 0.72, 0, 0.08),
    getCardCrop(image, 0.56, 0, 0),
  ];
}

function buildRegionHashes(image: Awaited<ReturnType<typeof loadImage>>) {
  const width = image.bitmap.width;
  const height = image.bitmap.height;

  const nameBar = image
    .clone()
    .crop({
      x: Math.floor(width * 0.015),
      y: 0,
      w: Math.max(32, Math.floor(width * 0.97)),
      h: Math.max(24, Math.floor(height * 0.16)),
    })
    .contain({ w: 256, h: 64 })
    .hash();

  const artBox = image
    .clone()
    .crop({
      x: Math.floor(width * 0.06),
      y: Math.floor(height * 0.11),
      w: Math.max(40, Math.floor(width * 0.88)),
      h: Math.max(48, Math.floor(height * 0.36)),
    })
    .contain({ w: 256, h: 160 })
    .hash();

  const footerLeft = image
    .clone()
    .crop({
      x: Math.floor(width * 0.01),
      y: Math.floor(height * 0.83),
      w: Math.max(32, Math.floor(width * 0.48)),
      h: Math.max(24, Math.floor(height * 0.13)),
    })
    .contain({ w: 220, h: 80 })
    .hash();

  return { nameBar, artBox, footerLeft };
}

async function getPreparedHashes(source: string) {
  const cached = hashCache.get(source);

  if (cached) {
    return JSON.parse(cached) as PreparedHashes;
  }

  const image = await loadImage(source);
  const full = image.clone().contain({ w: 256, h: 356 }).hash();
  const candidates = buildCandidateCrops(image).map((crop) => crop.contain({ w: 256, h: 356 }).hash());
  const regionHashes = buildRegionHashes(image);
  const prepared = { full, candidates, ...regionHashes };

  hashCache.set(source, JSON.stringify(prepared));
  return prepared;
}

function getPreparedHashesFromCatalogCard(card: CatalogRecognitionCard): PreparedHashes | null {
  if (!card.imageHashFull || !card.imageHashCandidates) {
    return null;
  }

  try {
    const candidates = JSON.parse(card.imageHashCandidates) as string[];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    return {
      full: card.imageHashFull,
      candidates,
      artBox: candidates[0] ?? card.imageHashFull,
      footerLeft: candidates[1] ?? card.imageHashFull,
      nameBar: candidates[2] ?? card.imageHashFull,
    };
  } catch {
    return null;
  }
}

function buildFilenameScore(fileName: string, card: CatalogRecognitionCard) {
  const normalizedFileName = normalizeLookupValue(fileName);
  const tokens = normalizeLookupValue(card.name).split(" ").filter((token) => token.length > 1);

  if (tokens.length === 0) {
    return 0;
  }

  const matches = tokens.filter((token) => normalizedFileName.includes(token)).length;
  return matches / tokens.length;
}

function getCatalogImageUrl(card: CatalogRecognitionCard) {
  if (card.imageLargeUrl || card.imageSmallUrl) {
    return card.imageLargeUrl || card.imageSmallUrl;
  }

  if (card.externalSetId && card.cardNumber) {
    const collectorNumber = card.cardNumber.split("/")[0];
    return `https://images.pokemontcg.io/${card.externalSetId}/${collectorNumber}_hires.png`;
  }

  return null;
}

function extractOcrHints(ocrResult?: CardOcrResult): OcrHints {
  if (!ocrResult) {
    return {
      collectorNumbers: [],
      topTextCandidates: [],
      setCodeCandidates: [],
    };
  }

  const collectorNumbers = new Set<string>();
  const topTextCandidates = new Set<string>();
  const setCodeCandidates = new Set<string>();

  for (const entry of ocrResult.entries) {
    const normalizedText = entry.text.trim();
    const shouldTrustFooterText =
      normalizedText.length > 0 &&
      entry.score >= 0.55 &&
      (entry.region !== "full" || entry.y_ratio >= 0.55);

    if ((entry.region === "bottom" || entry.region === "full") && shouldTrustFooterText) {
      for (const candidate of extractCollectorNumberCandidates(normalizedText)) {
        collectorNumbers.add(candidate);
      }

      for (const setCode of extractSetCodeCandidates(normalizedText)) {
        setCodeCandidates.add(setCode);
      }
    }

    if ((entry.region === "top" || entry.region === "full") && entry.y_ratio <= 0.82 && entry.score >= 0.5) {
      const normalized = normalizeLookupValue(normalizedText);
      if (
        isStrongNameCandidate(normalized) &&
        !/^\d+$/.test(normalized) &&
        !OCR_STOPWORDS.has(normalized)
      ) {
        topTextCandidates.add(normalized);
      }
    }
  }

  return {
    collectorNumbers: Array.from(collectorNumbers),
    topTextCandidates: Array.from(topTextCandidates),
    setCodeCandidates: Array.from(setCodeCandidates),
  };
}

function filterCatalogCardsByOcrHints(catalogCards: CatalogRecognitionCard[], ocrHints: OcrHints) {
  let filtered = catalogCards;
  let attemptedNumberFilter = false;
  let attemptedNameFilter = false;
  const hasNameHints = ocrHints.topTextCandidates.length > 0;

  if (ocrHints.collectorNumbers.length > 0) {
    attemptedNumberFilter = true;
    const byNumber = filtered.filter((card) => {
      const normalizedCardNumber = normalizeCollectorNumber(card.cardNumber);
      const primaryCardNumber = normalizeCollectorNumber(card.cardNumber.split("/")[0] ?? card.cardNumber);

      return ocrHints.collectorNumbers.some(
        (candidate) => candidate === normalizedCardNumber || candidate === primaryCardNumber,
      );
    });

    if (byNumber.length > 0) {
      if (!hasNameHints && byNumber.length > 12) {
        return [];
      }
      filtered = byNumber;
    } else {
      const partialByNumber = filtered.filter((card) => {
        const normalizedCardNumber = normalizeCollectorNumber(card.cardNumber);
        const primaryCardNumber = normalizeCollectorNumber(card.cardNumber.split("/")[0] ?? card.cardNumber);

        return ocrHints.collectorNumbers.some(
          (candidate) =>
            normalizedCardNumber.includes(candidate) ||
            primaryCardNumber.includes(candidate) ||
            candidate.includes(primaryCardNumber),
        );
      });

      if (partialByNumber.length > 0) {
        if (!hasNameHints && partialByNumber.length > 12) {
          return [];
        }
        filtered = partialByNumber;
      } else if (ocrHints.topTextCandidates.length === 0) {
        return [];
      }
    }
  }

  if (ocrHints.setCodeCandidates.length > 0) {
    const bySetCode = filtered.filter((card) =>
      ocrHints.setCodeCandidates.some(
        (candidate) =>
          normalizeSetCode(card.externalSetId ?? "") === candidate ||
          normalizeSetCode(card.externalSetId ?? "").startsWith(candidate),
      ),
    );

    if (bySetCode.length > 0) {
      filtered = bySetCode;
    }
  }

  if (ocrHints.topTextCandidates.length > 0) {
    const exactNameMatches = filtered.filter((card) => {
      const normalizedCardName = normalizeLookupValue(card.name);
      return ocrHints.topTextCandidates.some((candidate) => candidate === normalizedCardName);
    });

    if (exactNameMatches.length > 0) {
      filtered = exactNameMatches;
    }

    attemptedNameFilter = true;
    const byName = filtered.filter((card) => {
      const normalizedCardName = normalizeLookupValue(card.name);
      return ocrHints.topTextCandidates.some(
        (candidate) =>
          normalizedCardName.includes(candidate) || candidate.includes(normalizedCardName),
      );
    });

    if (byName.length > 0) {
      filtered = byName;
    } else {
      const fuzzyByName = filtered.filter((card) => {
        const normalizedCardName = normalizeLookupValue(card.name);
        return ocrHints.topTextCandidates.some((candidate) => isFuzzyNameMatch(candidate, normalizedCardName));
      });

      if (fuzzyByName.length > 0) {
        filtered = fuzzyByName;
      } else if (attemptedNumberFilter || attemptedNameFilter) {
        return filtered.length > 0 ? filtered : [];
      }
    }
  }

  return filtered;
}

function buildOcrNameScore(card: CatalogRecognitionCard, ocrHints: OcrHints) {
  if (ocrHints.topTextCandidates.length === 0) {
    return 0;
  }

  const normalizedCardName = normalizeLookupValue(card.name);
  const cardTokens = normalizedCardName.split(" ").filter(Boolean);
  let bestScore = 0;

  for (const candidate of ocrHints.topTextCandidates) {
    const candidateTokens = candidate.split(" ").filter(Boolean);

    if (candidate === normalizedCardName) {
      bestScore = Math.max(bestScore, 1);
      continue;
    }

    if (normalizedCardName.includes(candidate) || candidate.includes(normalizedCardName)) {
      const sharedTokens = candidateTokens.filter((token) => cardTokens.includes(token)).length;
      const overlapScore = sharedTokens / Math.max(cardTokens.length, candidateTokens.length, 1);
      const exactTokenCoverage = sharedTokens / Math.max(candidateTokens.length, 1);
      bestScore = Math.max(bestScore, overlapScore * 0.7 + exactTokenCoverage * 0.3);
      continue;
    }

    if (isFuzzyNameMatch(candidate, normalizedCardName)) {
      bestScore = Math.max(bestScore, buildFuzzyNameScore(candidate, normalizedCardName) * 0.92);
    }
  }

  return bestScore;
}

function hasExactOcrNameMatch(card: CatalogRecognitionCard, ocrHints: OcrHints) {
  const normalizedCardName = normalizeLookupValue(card.name);
  return ocrHints.topTextCandidates.some((candidate) => candidate === normalizedCardName);
}

function buildAlternateMatches(
  ranked: Array<{
    card: CatalogRecognitionCard;
    combinedScore: number;
  }>,
  bestCard: CatalogRecognitionCard,
) {
  const normalizedBestName = normalizeLookupValue(bestCard.name);
  const sameName = ranked.filter(
    (entry) => normalizeLookupValue(entry.card.name) === normalizedBestName,
  );
  const otherNames = ranked.filter(
    (entry) => normalizeLookupValue(entry.card.name) !== normalizedBestName,
  );

  return [...sameName, ...otherNames]
    .slice(0, 4)
    .map((entry) => `${entry.card.name} ${entry.card.cardNumber}`);
}

export async function recognizePokemonImageFromCatalog(
  filePath: string,
  fileName: string,
  catalogCards: CatalogRecognitionCard[],
  ocrResult?: CardOcrResult,
  options?: RecognitionOptions,
): Promise<RecognizedCardCandidate[]> {
  if (catalogCards.length === 0) {
    return [];
  }

  const allowFullCatalogFallback = options?.allowFullCatalogFallback ?? true;
  const allowHashOnlyFallbackWithoutHints = options?.allowHashOnlyFallbackWithoutHints ?? false;
  const ocrHints = extractOcrHints(ocrResult);
  let candidateCatalogCards = filterCatalogCardsByOcrHints(catalogCards, ocrHints);
  const hasOcrHints = ocrHints.collectorNumbers.length > 0 || ocrHints.topTextCandidates.length > 0;
  const hasOnlyWeakNameHints =
    ocrHints.topTextCandidates.length > 0 &&
    ocrHints.collectorNumbers.length === 0 &&
    ocrHints.setCodeCandidates.length === 0 &&
    candidateCatalogCards.length === catalogCards.length;

  if (!hasOcrHints && allowHashOnlyFallbackWithoutHints) {
    candidateCatalogCards = catalogCards.filter((card) => card.imageHashFull && card.imageHashCandidates);
  }

  if (hasOnlyWeakNameHints && allowHashOnlyFallbackWithoutHints) {
    candidateCatalogCards = catalogCards.filter((card) => card.imageHashFull && card.imageHashCandidates);
  }

  logRecognitionStage(
    fileName,
    `ocrNumbers=${ocrHints.collectorNumbers.join("|") || "-"} setCodes=${ocrHints.setCodeCandidates.join("|") || "-"} topText=${ocrHints.topTextCandidates.slice(0, 3).join("|") || "-"} candidates=${candidateCatalogCards.length}`,
  );

  if (!allowFullCatalogFallback && !hasOcrHints && !allowHashOnlyFallbackWithoutHints) {
    logRecognitionStage(fileName, "skipping full-catalog scan because OCR produced no usable hints");
    return [];
  }

  if (
    candidateCatalogCards.length === 0 &&
    hasOcrHints
  ) {
    logRecognitionStage(fileName, "no local candidates after OCR prefilter");
    return [];
  }

  const uploadedHashes = await getPreparedHashes(filePath);
  const cardsMissingPersistedHashes = candidateCatalogCards.filter(
    (card) => !card.imageHashFull || !card.imageHashCandidates,
  ).length;
  logRecognitionStage(
    fileName,
    `matching-start candidates=${candidateCatalogCards.length} missingHashes=${cardsMissingPersistedHashes}`,
  );

  const scoredCandidates = await Promise.all(
    candidateCatalogCards.map(async (card) => {
      const imageUrl = getCatalogImageUrl(card);

      if (!imageUrl) {
        return null;
      }

      try {
        const referenceHashes = getPreparedHashesFromCatalogCard(card) ?? (await getPreparedHashes(imageUrl));
        const fullScore = Math.max(0, 1 - compareHashes(uploadedHashes.full, referenceHashes.full));
        const candidateScores = uploadedHashes.candidates.flatMap((uploadedHash) =>
          referenceHashes.candidates.map((referenceHash) =>
            Math.max(0, 1 - compareHashes(uploadedHash, referenceHash)),
          ),
        );
        const cropScore = candidateScores.length > 0 ? Math.max(...candidateScores) : 0;
        const visualScore = Math.max(fullScore, cropScore);
        const filenameScore = buildFilenameScore(fileName, card);
        const ocrNameScore = buildOcrNameScore(card, ocrHints);
        const artScore = Math.max(0, 1 - compareHashes(uploadedHashes.artBox, referenceHashes.artBox));
        const footerScore = Math.max(
          0,
          1 - compareHashes(uploadedHashes.footerLeft, referenceHashes.footerLeft),
        );
        const nameBarScore = Math.max(
          0,
          1 - compareHashes(uploadedHashes.nameBar, referenceHashes.nameBar),
        );
        const sameNameVariantBoost =
          ocrHints.topTextCandidates.some((candidate) => candidate === normalizeLookupValue(card.name)) ||
          ocrHints.topTextCandidates.some((candidate) => normalizeLookupValue(card.name).includes(candidate))
            ? artScore * 0.22 + footerScore * 0.18 + nameBarScore * 0.08
            : 0;
        const combinedScore =
          visualScore * 0.45 +
          filenameScore * 0.08 +
          ocrNameScore * 0.27 +
          artScore * 0.12 +
          footerScore * 0.06 +
          nameBarScore * 0.02 +
          sameNameVariantBoost;

        return {
          card,
          visualScore,
          filenameScore,
          ocrNameScore,
          artScore,
          footerScore,
          nameBarScore,
          combinedScore,
        };
      } catch {
        return null;
      }
    }),
  );

  const ranked = scoredCandidates
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => right.combinedScore - left.combinedScore);
  logRecognitionStage(fileName, `matching-complete ranked=${ranked.length}`);

  const best = ranked[0];

  if (!best) {
    return [];
  }

  const bestName = normalizeLookupValue(best.card.name);
  const sameNameVariants = ranked.filter(
    (entry) => normalizeLookupValue(entry.card.name) === bestName,
  );
  const alternateMatches = buildAlternateMatches(ranked.slice(1), best.card);
  const secondSameNameVariant = sameNameVariants[1];
  const exactNameMatchedByOcr = hasExactOcrNameMatch(best.card, ocrHints);
  const missingReliableCollectorNumber = ocrHints.collectorNumbers.length === 0;
  const usedHashOnlyFallback = !hasOcrHints && allowHashOnlyFallbackWithoutHints;
  const variantAmbiguous =
    exactNameMatchedByOcr &&
    missingReliableCollectorNumber &&
    sameNameVariants.length > 1 &&
    Boolean(secondSameNameVariant) &&
    best.combinedScore - secondSameNameVariant.combinedScore <= 0.14;
  const shouldAutoMatch = best.combinedScore >= (usedHashOnlyFallback ? 0.86 : 0.78) && !variantAmbiguous;

  const ocrNote =
    ocrHints.collectorNumbers.length > 0 || ocrHints.topTextCandidates.length > 0
      ? ` OCR hints: ${[
          ...ocrHints.collectorNumbers,
          ...ocrHints.topTextCandidates.slice(0, 2),
        ].join(", ")}.`
      : "";
  const ambiguityNote = variantAmbiguous
    ? " Same-name variant unresolved; collector number was not confirmed."
    : "";
  const fallbackNote = usedHashOnlyFallback
    ? " OCR fallback used local visual hashes only."
    : "";
  const notes = `Visual match ${(best.visualScore * 100).toFixed(0)}% · filename hint ${(best.filenameScore * 100).toFixed(0)}%.${ocrNote}${ambiguityNote}${fallbackNote}`;

  return [
    {
      cardName: best.card.name,
      setName: best.card.setName,
      cardNumber: best.card.cardNumber,
      rarity: best.card.rarity ?? "Unknown",
      confidence: Number(best.combinedScore.toFixed(2)),
      status: shouldAutoMatch ? "MATCHED" : "NEEDS_REVIEW",
      notes,
      review:
        shouldAutoMatch
          ? undefined
          : {
              suggestedMatch: `${best.card.name} ${best.card.cardNumber}`,
              alternateMatches,
              reason: variantAmbiguous
                ? "This looks like the right Pokemon, but multiple variants of the same card are still too close to auto-confirm."
                : "Visual comparison is still below confidence threshold and needs manual confirmation.",
            },
    },
  ];
}

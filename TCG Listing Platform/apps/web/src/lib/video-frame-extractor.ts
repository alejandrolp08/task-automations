import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { Jimp, compareHashes } from "jimp";

const execFile = promisify(execFileCallback);

type ExtractedVideoFrames = {
  durationSeconds?: number;
  intervalSeconds: number;
  frames: string[];
};

type CandidateFrame = {
  filePath: string;
  sharpnessScore: number;
  transitionScore: number;
};

type RankedCandidateFrame = CandidateFrame & {
  index: number;
  selectionScore: number;
};

function getRedChannel(pixelColor: number) {
  return (pixelColor >> 24) & 255;
}

function buildSamplingSettings(durationSeconds?: number) {
  const safeDuration = durationSeconds && durationSeconds > 0 ? durationSeconds : 6;

  if (safeDuration <= 90) {
    return { fps: 4, maxCandidates: 360 };
  }

  if (safeDuration <= 180) {
    return { fps: 3, maxCandidates: 240 };
  }

  return { fps: 2, maxCandidates: 240 };
}

async function extractCandidateFrames(videoPath: string, outputDirectory: string, durationSeconds?: number) {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary is unavailable.");
  }

  const { fps, maxCandidates } = buildSamplingSettings(durationSeconds);
  const safeDuration = durationSeconds && durationSeconds > 0 ? durationSeconds : 6;
  const outputPattern = path.join(outputDirectory, "candidate-%04d.png");

  await execFile(ffmpegPath, [
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=${fps},scale='min(900,iw)':-2`,
    "-frames:v",
    String(Math.max(12, Math.min(maxCandidates, Math.ceil(safeDuration * fps)))),
    outputPattern,
  ]);

  const files = (await fs.readdir(outputDirectory))
    .filter((entry) => entry.endsWith(".png"))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => path.join(outputDirectory, entry));

  return {
    fps,
    files,
  };
}

async function computeSharpnessScore(framePath: string) {
  const image = await Jimp.read(framePath);
  const grayscale = image.clone().contain({ w: 180, h: 252 }).greyscale();
  const { width, height } = grayscale.bitmap;

  if (width < 3 || height < 3) {
    return 0;
  }

  let total = 0;
  let samples = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = getRedChannel(grayscale.getPixelColor(x, y));
      const left = getRedChannel(grayscale.getPixelColor(x - 1, y));
      const right = getRedChannel(grayscale.getPixelColor(x + 1, y));
      const up = getRedChannel(grayscale.getPixelColor(x, y - 1));
      const down = getRedChannel(grayscale.getPixelColor(x, y + 1));

      total +=
        Math.abs(left - center) +
        Math.abs(right - center) +
        Math.abs(up - center) +
        Math.abs(down - center);
      samples += 4;
    }
  }

  return samples > 0 ? total / samples : 0;
}

async function computeFrameHashes(framePaths: string[]) {
  return Promise.all(
    framePaths.map(async (framePath) => {
      const image = await Jimp.read(framePath);
      return image.clone().contain({ w: 256, h: 356 }).hash();
    }),
  );
}

function normalizeScore(value: number, min: number, max: number) {
  if (max <= min) {
    return 1;
  }

  return (value - min) / (max - min);
}

function buildSegments(candidates: CandidateFrame[], segmentBreakThreshold: number) {
  const segments: CandidateFrame[][] = [];
  let currentSegment: CandidateFrame[] = [];

  for (const candidate of candidates) {
    if (currentSegment.length === 0) {
      currentSegment.push(candidate);
      continue;
    }

    if (candidate.transitionScore >= segmentBreakThreshold) {
      segments.push(currentSegment);
      currentSegment = [candidate];
      continue;
    }

    currentSegment.push(candidate);
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}

function buildSelectionScore(candidate: CandidateFrame) {
  return candidate.sharpnessScore - candidate.transitionScore * 0.22;
}

function mergeRankedCandidates(
  preferred: RankedCandidateFrame[],
  supplemental: RankedCandidateFrame[],
  maxCount: number,
) {
  const merged = new Map<number, RankedCandidateFrame>();

  for (const candidate of [...preferred, ...supplemental]) {
    const current = merged.get(candidate.index);
    if (!current || candidate.selectionScore > current.selectionScore) {
      merged.set(candidate.index, candidate);
    }
  }

  return Array.from(merged.values())
    .sort((left, right) => left.index - right.index)
    .slice(0, maxCount);
}

function pruneNearbyCandidates(
  candidates: RankedCandidateFrame[],
  minGap: number,
  maxCount: number,
) {
  const sortedByScore = [...candidates].sort((left, right) => right.selectionScore - left.selectionScore);
  const selected: RankedCandidateFrame[] = [];

  for (const candidate of sortedByScore) {
    const isTooClose = selected.some((entry) => Math.abs(entry.index - candidate.index) < minGap);
    if (isTooClose) {
      continue;
    }

    selected.push(candidate);

    if (selected.length >= maxCount) {
      break;
    }
  }

  return selected.sort((left, right) => left.index - right.index);
}

async function selectSegmentFrames(framePaths: string[], fps: number) {
  if (framePaths.length <= 3) {
    return framePaths;
  }

  const sharpnessScores = await Promise.all(framePaths.map((framePath) => computeSharpnessScore(framePath)));
  const hashes = await computeFrameHashes(framePaths);
  const pairDiffs = framePaths.map((_, index) => {
    if (index === 0) {
      return 1;
    }

    return compareHashes(hashes[index], hashes[index - 1]);
  });

  const minSharpness = Math.min(...sharpnessScores);
  const maxSharpness = Math.max(...sharpnessScores);
  const minDiff = Math.min(...pairDiffs);
  const maxDiff = Math.max(...pairDiffs);

  const candidates = framePaths.map(
    (filePath, index): CandidateFrame => ({
      filePath,
      sharpnessScore: normalizeScore(sharpnessScores[index], minSharpness, maxSharpness),
      transitionScore: normalizeScore(pairDiffs[index], minDiff, maxDiff),
    }),
  );
  const rankedCandidates: RankedCandidateFrame[] = candidates.map((candidate, index) => ({
    ...candidate,
    index,
    selectionScore: buildSelectionScore(candidate),
  }));
  const stableCandidates = rankedCandidates.filter(
    (candidate) => candidate.sharpnessScore >= 0.18 && candidate.transitionScore <= 0.72,
  );

  const segmentBreakThreshold = 0.22;
  const minSegmentFrames = 1;
  const segments = buildSegments(candidates, segmentBreakThreshold);
  const segmentCount = segments.filter((segment) => segment.length >= minSegmentFrames).length;
  const maxOutputFrames = Math.max(10, Math.min(80, segmentCount || framePaths.length));
  const targetOutputFrames = Math.max(
    10,
    Math.min(maxOutputFrames, Math.round((segmentCount || framePaths.length) * 1.05)),
  );

  const selected = segments
    .filter((segment) => segment.length >= minSegmentFrames)
    .map((segment) => {
      const bestPool = segment
        .map((entry) => rankedCandidates.find((candidate) => candidate.filePath === entry.filePath))
        .filter((entry): entry is RankedCandidateFrame => Boolean(entry))
        .filter((entry) => stableCandidates.some((stable) => stable.filePath === entry.filePath));
      const best = [...(bestPool.length > 0 ? bestPool : segment.map((entry) => ({
        ...entry,
        index: candidates.findIndex((candidate) => candidate.filePath === entry.filePath),
        selectionScore: buildSelectionScore(entry),
      })))].sort((left, right) => {
        const leftScore = buildSelectionScore(left);
        const rightScore = buildSelectionScore(right);
        return rightScore - leftScore;
      })[0];
      return {
        ...best,
        index: best.index,
        selectionScore: best.selectionScore,
      };
    })
    .filter((candidate) => candidate.index >= 0)
    .slice(0, maxOutputFrames);

  const windowSize = Math.max(2, Math.round(fps * 0.5));
  const windowSelections: RankedCandidateFrame[] = [];

  for (let start = 0; start < stableCandidates.length; start += windowSize) {
    const window = stableCandidates.slice(start, start + windowSize);
    if (window.length === 0) {
      continue;
    }

    const bestInWindow = [...window].sort((left, right) => right.selectionScore - left.selectionScore)[0];
    windowSelections.push(bestInWindow);
  }

  const augmentedSelection = mergeRankedCandidates(
    selected,
    windowSelections,
    Math.max(targetOutputFrames, selected.length),
  );
  const prunedSelection = pruneNearbyCandidates(
    augmentedSelection.length > 0 ? augmentedSelection : stableCandidates,
    Math.max(1, Math.round(fps * 0.3)),
    Math.max(10, targetOutputFrames),
  );

  const fallbackSelection =
    prunedSelection.length > 0
      ? prunedSelection
      : [...rankedCandidates]
          .sort((left, right) => right.selectionScore - left.selectionScore)
          .slice(0, Math.max(6, Math.min(12, Math.round(framePaths.length / 5))))
          .sort((left, right) => left.index - right.index);

  const keepSet = new Set(fallbackSelection.map((candidate) => candidate.filePath));

  for (const framePath of framePaths) {
    if (!keepSet.has(framePath)) {
      await fs.rm(framePath, { force: true });
    }
  }

  const finalPaths: string[] = [];

  for (const [index, candidate] of fallbackSelection.entries()) {
    const finalPath = path.join(
      path.dirname(candidate.filePath),
      `frame-${String(index + 1).padStart(3, "0")}.png`,
    );

    if (candidate.filePath !== finalPath) {
      await fs.rename(candidate.filePath, finalPath);
    }

    finalPaths.push(finalPath);
  }

  return finalPaths;
}

export async function extractVideoFrames(
  videoPath: string,
  outputDirectory: string,
  durationSeconds?: number,
): Promise<ExtractedVideoFrames> {
  await fs.mkdir(outputDirectory, { recursive: true });

  const existingEntries = await fs.readdir(outputDirectory).catch(() => []);
  await Promise.all(
    existingEntries.map((entry) =>
      fs.rm(path.join(outputDirectory, entry), { force: true, recursive: true }),
    ),
  );

  const { fps, files } = await extractCandidateFrames(videoPath, outputDirectory, durationSeconds);
  const frames = await selectSegmentFrames(files, fps);

  return {
    durationSeconds,
    intervalSeconds: 1 / fps,
    frames,
  };
}

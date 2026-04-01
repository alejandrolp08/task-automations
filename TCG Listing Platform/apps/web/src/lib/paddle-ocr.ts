import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { resolveProjectRoot } from "./project-paths";

const execFile = promisify(execFileCallback);

export type OcrRegion = "full" | "top" | "bottom";

export type OcrTextEntry = {
  text: string;
  score: number;
  y_ratio: number;
  region: OcrRegion;
};

export type CardOcrResult = {
  imagePath: string;
  entries: OcrTextEntry[];
};

export type OcrImageInput = {
  imagePath: string;
  sourceImagePath?: string;
  region?: OcrRegion;
};

function resolvePythonBinary(projectRoot: string) {
  const venvPython = path.join(projectRoot, ".venv", "bin", "python");
  return fs.existsSync(venvPython) ? venvPython : "python3";
}

export async function runPaddleOcrOnImages(inputs: OcrImageInput[]): Promise<CardOcrResult[]> {
  if (inputs.length === 0) {
    return [];
  }

  const projectRoot = resolveProjectRoot();
  const pythonBinary = resolvePythonBinary(projectRoot);
  const scriptPath = path.join(projectRoot, "scripts", "paddle_ocr_card.py");
  const imageInputs = inputs.map((input) => ({
    imagePath: input.imagePath,
    sourceImagePath: input.sourceImagePath ?? input.imagePath,
    region: input.region ?? "full",
  }));
  const { stdout } = await execFile(
    pythonBinary,
    [scriptPath, ...imageInputs.map((input) => input.imagePath)],
    {
    env: {
      ...process.env,
      PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
    },
    maxBuffer: 1024 * 1024 * 8,
    },
  );
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("["));

  if (!jsonLine) {
    throw new Error("PaddleOCR did not return a JSON payload.");
  }

  const rawResults = JSON.parse(jsonLine) as Array<{
    imagePath: string;
    entries: Array<Omit<OcrTextEntry, "region">>;
  }>;
  const inputsByImagePath = new Map(imageInputs.map((input) => [input.imagePath, input]));
  const groupedResults = new Map<string, OcrTextEntry[]>();

  for (const result of rawResults) {
    const input = inputsByImagePath.get(result.imagePath);

    if (!input) {
      continue;
    }

    const existingEntries = groupedResults.get(input.sourceImagePath) ?? [];
    existingEntries.push(
      ...result.entries.map((entry) => ({
        ...entry,
        region: input.region,
      })),
    );
    groupedResults.set(input.sourceImagePath, existingEntries);
  }

  return imageInputs
    .map((input) => input.sourceImagePath)
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((sourceImagePath) => ({
      imagePath: sourceImagePath,
      entries: groupedResults.get(sourceImagePath) ?? [],
    }));
}

import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { resolveProjectRoot } from "./project-paths";

const execFile = promisify(execFileCallback);

export type CardDetectionBox = {
  imagePath: string;
  classId?: number;
  className?: string;
  confidence?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

function resolvePythonBinary(projectRoot: string) {
  const venvPython = path.join(projectRoot, ".venv", "bin", "python");
  return fs.existsSync(venvPython) ? venvPython : "python3";
}

export async function detectMainCardsWithYolo(imagePaths: string[]): Promise<CardDetectionBox[]> {
  if (imagePaths.length === 0) {
    return [];
  }

  const projectRoot = resolveProjectRoot();
  const pythonBinary = resolvePythonBinary(projectRoot);
  const scriptPath = path.join(projectRoot, "scripts", "detect_main_card.py");
  const { stdout } = await execFile(pythonBinary, [scriptPath, ...imagePaths], {
    env: {
      ...process.env,
      PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
    },
    maxBuffer: 1024 * 1024 * 16,
  });
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("["));

  if (!jsonLine) {
    throw new Error("YOLO detector did not return a JSON payload.");
  }

  return JSON.parse(jsonLine) as CardDetectionBox[];
}

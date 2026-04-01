import fs from "node:fs/promises";
import path from "node:path";
import { createSqliteBatch } from "../apps/web/src/lib/sqlite-repository.ts";
import { importExistingUploadFromPath } from "../apps/web/src/lib/upload-service.ts";
import { resolveProjectRoot } from "../apps/web/src/lib/project-paths.ts";

type CliOptions = {
  batchId?: string;
  batchName?: string;
  sellerLabel?: string;
  file?: string;
  cropDebugOnly?: boolean;
};

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const nextValue = argv[index + 1];

    if (value === "--batch-id" && nextValue) {
      options.batchId = nextValue;
      index += 1;
      continue;
    }

    if (value === "--batch-name" && nextValue) {
      options.batchName = nextValue;
      index += 1;
      continue;
    }

    if (value === "--seller-label" && nextValue) {
      options.sellerLabel = nextValue;
      index += 1;
      continue;
    }

    if (value === "--file" && nextValue) {
      options.file = nextValue;
      index += 1;
      continue;
    }

    if (value === "--crop-debug-only") {
      options.cropDebugOnly = true;
    }
  }

  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const projectRoot = resolveProjectRoot();
  const rootUploadsDirectory = path.join(projectRoot, "data", "uploads");
  const entries = await fs.readdir(rootUploadsDirectory, { withFileTypes: true });
  const videoFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(mov|mp4|m4v)$/i.test(name))
    .filter((name) => (options.file ? name === options.file : true))
    .sort((left, right) => left.localeCompare(right));

  if (videoFiles.length === 0) {
    console.log("No root-level video files found in data/uploads.");
    return;
  }

  const batchId =
    options.batchId ??
    (await createSqliteBatch({
      name: options.batchName ?? "Imported Local Video Intake",
      sellerLabel: options.sellerLabel ?? "Local Import",
      intakeMode: "video",
    }));

  console.log(`Using batch ${batchId}`);

  for (const fileName of videoFiles) {
    const absoluteFilePath = path.join(rootUploadsDirectory, fileName);
    console.log(`Importing ${fileName}...`);

    const result = await importExistingUploadFromPath({
      batchId,
      intakeMode: "video",
      absoluteFilePath,
      originalFileName: fileName,
    }, {
      cropDebugOnly: options.cropDebugOnly,
    });

    console.log(
      `Imported ${fileName}: upload=${result.uploadId} detections=${result.processingResult.detectionsAdded} reviews=${result.processingResult.reviewCountAdded}`,
    );
    console.log(
      `Metrics ${fileName}: catalog=${result.metrics.catalogSize} frames=${result.metrics.extractedFrameCount ?? 1} ocr=${result.metrics.ocrImageCount} totalMs=${result.metrics.totalMs} recognizeMs=${result.metrics.recognizeMs}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

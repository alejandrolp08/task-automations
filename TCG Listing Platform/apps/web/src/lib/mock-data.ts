import rawBatches from "../../../../data/mock-batches.json";
import type { BatchDetail, BatchSummary } from "./types";

export const batches: BatchDetail[] = (rawBatches as unknown as BatchDetail[]).map((batch) => ({
  ...batch,
  detections: batch.detections.map((detection) => ({
    ...detection,
    resolvedByReview: detection.resolvedByReview ?? false,
  })),
}));

export const batchSummaries: BatchSummary[] = batches.map(
  ({ listingSettings, uploads, detections, reviewQueue, exportRuns, ...summary }) => summary,
);

export function getBatchById(batchId: string) {
  return batches.find((batch) => batch.id === batchId);
}

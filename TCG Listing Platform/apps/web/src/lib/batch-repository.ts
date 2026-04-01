import { batchSummaries as mockBatchSummaries, batches as mockBatches } from "./mock-data";
import { getSqliteBatchDetail, getSqliteBatchVideoDebug, listSqliteBatches } from "./sqlite-repository";
import type { BatchDetail, BatchSummary, VideoDebugUpload } from "./types";

export async function listBatches(): Promise<BatchSummary[]> {
  try {
    const rows = await listSqliteBatches();
    if (rows.length === 0) {
      return mockBatchSummaries;
    }
    return rows;
  } catch {
    return mockBatchSummaries;
  }
}

export async function getBatchDetail(batchId: string): Promise<BatchDetail | null> {
  try {
    const batch = await getSqliteBatchDetail(batchId);
    if (!batch) {
      return mockBatches.find((item) => item.id === batchId) ?? null;
    }
    return batch;
  } catch {
    return mockBatches.find((item) => item.id === batchId) ?? null;
  }
}

export async function getBatchVideoDebug(batchId: string): Promise<VideoDebugUpload[]> {
  try {
    return await getSqliteBatchVideoDebug(batchId);
  } catch {
    return [];
  }
}

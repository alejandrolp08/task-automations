"use server";

import { redirect } from "next/navigation";
import { generateEbayDraftCsv } from "@/lib/ebay-export";

export async function generateExportAction(formData: FormData) {
  const batchIdValue = formData.get("batchId");
  const batchId = typeof batchIdValue === "string" ? batchIdValue.trim() : "";

  if (!batchId) {
    throw new Error("Batch id is required.");
  }

  await generateEbayDraftCsv(batchId);
  redirect(`/batches/${batchId}`);
}

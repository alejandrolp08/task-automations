"use server";

import { redirect } from "next/navigation";
import { createSqliteBatch } from "@/lib/sqlite-repository";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createBatchAction(formData: FormData) {
  const name = getStringValue(formData, "name");
  const sellerLabel = getStringValue(formData, "sellerLabel");
  const intakeMode = getStringValue(formData, "intakeMode") === "images" ? "images" : "video";

  if (!name) {
    throw new Error("Batch name is required.");
  }

  const batchId = await createSqliteBatch({
    name,
    sellerLabel: sellerLabel || "Unlabeled seller",
    intakeMode,
  });

  redirect(`/batches/${batchId}`);
}

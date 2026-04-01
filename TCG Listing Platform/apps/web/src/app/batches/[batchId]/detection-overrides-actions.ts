"use server";

import { revalidatePath } from "next/cache";
import { updateDetectionOverrides } from "@/lib/sqlite-repository";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveDetectionOverridesAction(formData: FormData) {
  const batchId = getStringValue(formData, "batchId");
  const detectionId = getStringValue(formData, "detectionId");

  if (!batchId || !detectionId) {
    throw new Error("Batch id and detection id are required.");
  }

  await updateDetectionOverrides({
    batchId,
    detectionId,
    titleOverride: getStringValue(formData, "titleOverride"),
    priceOverride: getStringValue(formData, "priceOverride"),
    quantityOverride: getStringValue(formData, "quantityOverride"),
    conditionOverride: getStringValue(formData, "conditionOverride"),
    excludeFromExport: formData.get("excludeFromExport") === "on",
  });

  revalidatePath("/batches");
  revalidatePath(`/batches/${batchId}`);
}

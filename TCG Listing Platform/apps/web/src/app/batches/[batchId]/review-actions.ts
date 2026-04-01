"use server";

import { revalidatePath } from "next/cache";
import { resolveReviewItem } from "@/lib/sqlite-repository";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function resolveReviewItemAction(formData: FormData) {
  const batchId = getStringValue(formData, "batchId");
  const reviewItemId = getStringValue(formData, "reviewItemId");
  const decision = getStringValue(formData, "decision") === "dismiss" ? "dismiss" : "accept";
  const selectedMatch = getStringValue(formData, "selectedMatch");

  if (!batchId || !reviewItemId) {
    throw new Error("Batch id and review item id are required.");
  }

  await resolveReviewItem(batchId, reviewItemId, decision, selectedMatch);

  revalidatePath("/batches");
  revalidatePath(`/batches/${batchId}`);
}

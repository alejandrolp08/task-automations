"use server";

import { revalidatePath } from "next/cache";
import { saveBatchUpload } from "@/lib/upload-service";

function getStringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function uploadBatchMediaAction(formData: FormData) {
  const batchId = getStringValue(formData, "batchId");
  const intakeMode = getStringValue(formData, "intakeMode") === "images" ? "images" : "video";
  const media = formData.get("media");

  if (!batchId) {
    throw new Error("Batch id is required.");
  }

  if (!(media instanceof File) || media.size === 0) {
    throw new Error("A media file is required.");
  }

  await saveBatchUpload({
    batchId,
    intakeMode,
    file: media,
  });

  revalidatePath("/batches");
  revalidatePath(`/batches/${batchId}`);
}

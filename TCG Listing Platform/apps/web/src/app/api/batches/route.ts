import { NextResponse } from "next/server";
import { createSqliteBatch } from "@/lib/sqlite-repository";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sellerLabel =
    typeof body.sellerLabel === "string" && body.sellerLabel.trim()
      ? body.sellerLabel.trim()
      : "Unlabeled seller";
  const intakeMode = body.intakeMode === "images" ? "images" : "video";

  if (!name) {
    return NextResponse.json({ error: "Batch name is required." }, { status: 400 });
  }

  const batchId = await createSqliteBatch({
    name,
    sellerLabel,
    intakeMode,
  });

  return NextResponse.json({
    id: batchId,
    status: "created",
  });
}

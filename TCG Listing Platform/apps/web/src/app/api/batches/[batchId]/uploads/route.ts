import { NextResponse } from "next/server";
import { saveBatchUpload } from "@/lib/upload-service";

type RouteProps = {
  params: Promise<{
    batchId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const { batchId } = await params;
  const formData = await request.formData();
  const intakeMode = formData.get("intakeMode") === "images" ? "images" : "video";
  const media = formData.get("media");

  if (!(media instanceof File) || media.size === 0) {
    return NextResponse.json({ error: "A media file is required." }, { status: 400 });
  }

  const result = await saveBatchUpload({
    batchId,
    intakeMode,
    file: media,
  });

  return NextResponse.json({
    status: "uploaded",
    batchId,
    fileName: media.name,
    uploadId: result.uploadId,
    processingResult: result.processingResult,
  });
}

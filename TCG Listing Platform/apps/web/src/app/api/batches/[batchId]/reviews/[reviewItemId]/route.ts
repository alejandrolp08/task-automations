import { NextResponse } from "next/server";
import { resolveReviewItem } from "@/lib/sqlite-repository";

type RouteProps = {
  params: Promise<{
    batchId: string;
    reviewItemId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const { batchId, reviewItemId } = await params;
  const body = await request.json().catch(() => null);
  const decision = body?.decision === "dismiss" ? "dismiss" : "accept";
  const selectedMatch = typeof body?.selectedMatch === "string" ? body.selectedMatch.trim() : "";

  await resolveReviewItem(batchId, reviewItemId, decision, selectedMatch);

  return NextResponse.json({
    status: "resolved",
    batchId,
    reviewItemId,
    decision,
    selectedMatch,
  });
}

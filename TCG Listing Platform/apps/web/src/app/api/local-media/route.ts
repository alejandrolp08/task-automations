import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveProjectRoot } from "@/lib/project-paths";

function getContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedPath = searchParams.get("path");

  if (!requestedPath) {
    return NextResponse.json({ error: "Path is required." }, { status: 400 });
  }

  const projectRoot = resolveProjectRoot();
  const uploadsRoot = path.join(projectRoot, "data", "uploads");
  const absolutePath = path.resolve(projectRoot, requestedPath);

  if (!absolutePath.startsWith(uploadsRoot)) {
    return NextResponse.json({ error: "Invalid media path." }, { status: 400 });
  }

  try {
    const file = await fs.readFile(absolutePath);

    return new NextResponse(file, {
      headers: {
        "Content-Type": getContentType(absolutePath),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Media file not found." }, { status: 404 });
  }
}

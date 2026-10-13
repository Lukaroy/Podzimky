import { get } from "@vercel/blob";
import { NextResponse } from "next/server";

import { getSession, getSessionToken } from "@/lib/auth";
import { readGameState } from "@/lib/game-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaPath: string[] }> },
) {
  const user = await getSession(getSessionToken(request));
  if (!user) return NextResponse.json({ error: "Přihlaste se pro přehrání souboru." }, { status: 401 });
  const { mediaPath } = await params;
  const pathname = mediaPath.join("/");
  if (!/^team-[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|avif|mp4|webm|mov)$/i.test(pathname)) {
    return NextResponse.json({ error: "Soubor nebyl nalezen." }, { status: 404 });
  }
  const mediaUrl = `/api/media/${pathname}`;
  const state = await readGameState();
  const isAllowed = state.submissions.some(
    (submission) =>
      submission.mediaUrl === mediaUrl &&
      (user.role === "admin" || submission.teamId === user.teamId),
  );
  if (!isAllowed) return NextResponse.json({ error: "Soubor nebyl nalezen." }, { status: 404 });

  const blob = await get(pathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: "Soubor nebyl nalezen." }, { status: 404 });
  }
  const fileName = pathname.split("/").at(-1) ?? "soubor";
  const disposition = new URL(request.url).searchParams.has("download")
    ? `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    : "inline";
  return new Response(blob.stream, {
    headers: {
      "Content-Type": blob.blob.contentType,
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

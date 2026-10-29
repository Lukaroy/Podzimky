import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, verifyRequestOrigin } from "@/lib/auth";
import { readGameState } from "@/lib/game-store";

const MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

// Vydá týmu omezený token pro nahrání jeho vlastního důkazu.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "team") {
    return NextResponse.json({ error: "Přihlaste se jako tým." }, { status: 401 });
  }
  if ((await readGameState()).gameClosedAt) {
    return NextResponse.json({ error: "Hra je uzavřená; média už nelze odesílat." }, { status: 409 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    return NextResponse.json(
      {
        code: "BLOB_NOT_CONFIGURED",
        error: "Nahrávání fotek není na serveru nakonfigurované. Chybí BLOB_READ_WRITE_TOKEN.",
      },
      { status: 503 },
    );
  }

  try {
    const body = await request.json() as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        // Každý tým dostane oprávnění nahrávat jen do vlastního adresáře.
        const prefix = `team-${user.teamId}/`;
        if (!pathname.startsWith(prefix) || !/^team-[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|avif|mp4|webm|mov)$/i.test(pathname)) {
          throw new Error("Neplatná cesta souboru.");
        }
        return {
          allowedContentTypes: MEDIA_TYPES,
          maximumSizeInBytes: 100 * 1024 * 1024,
          addRandomSuffix: false,
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        code: "BLOB_TOKEN_GENERATION_FAILED",
        error: "Vercel Blob odmítl vytvořit nahrávací oprávnění. Zkontrolujte nastavení Blob úložiště.",
      },
      { status: 503 },
    );
  }
}

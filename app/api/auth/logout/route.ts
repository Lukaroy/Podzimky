import { NextResponse } from "next/server";

import {
  getSessionToken,
  revokeSession,
  SESSION_COOKIE_NAME,
  verifyRequestOrigin,
} from "@/lib/auth";

// Zneplatní serverovou relaci a vymaže její cookie z prohlížeče.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  // Odhlášení odstraní relaci na serveru i cookie v prohlížeči.
  await revokeSession(getSessionToken(request));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}

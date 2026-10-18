import { NextResponse } from "next/server";

import {
  getSession,
  getSessionToken,
  sanitizeGameState,
  SESSION_COOKIE_NAME,
  storeFirebaseSession,
  verifyRequestOrigin,
} from "@/lib/auth";
import { createFirebaseSessionCookie } from "@/lib/firebase-admin";
import { readGameState } from "@/lib/game-store";

// Načte uživatele relace a jeho oprávněný stav pro obnovu stránky.
export async function GET(request: Request) {
  const user = await getSession(getSessionToken(request));
  if (!user) return NextResponse.json({ error: "Přihlášení vypršelo." }, { status: 401 });

  const state = await readGameState();
  return NextResponse.json({ user, state: sanitizeGameState(state, user) });
}

// Vymění ověřený Firebase token za serverovou cookie a uloženou relaci.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  let body: { idToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  if (typeof body.idToken !== "string" || body.idToken.length > 12_000) {
    return NextResponse.json({ error: "Firebase token je neplatný." }, { status: 401 });
  }

  let session;
  try {
    // Firebase ověří identitu a server teprve potom vydá vlastní HTTP-only cookie.
    session = await createFirebaseSessionCookie(body.idToken);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && error.code.startsWith("auth/")) {
      return NextResponse.json({ error: "Firebase přihlášení vypršelo." }, { status: 401 });
    }
    throw error;
  }
  if (!session) return NextResponse.json({ error: "Tento účet nemá přístup ke hře." }, { status: 403 });

  const state = await readGameState();
  if (session.user.role === "team" && !state.teams.some((team) => team.id === session.user.teamId)) {
    return NextResponse.json({ error: "Tým již není dostupný." }, { status: 403 });
  }
  await storeFirebaseSession(session.cookie, session.firebaseUid, session.user, session.expiresAt);
  const response = NextResponse.json({
    user: session.user,
    state: sanitizeGameState(state, session.user),
  });
  response.cookies.set(SESSION_COOKIE_NAME, session.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return response;
}

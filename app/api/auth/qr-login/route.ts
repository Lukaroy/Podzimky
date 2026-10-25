import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { createTeamCustomToken } from "@/lib/firebase-admin";
import { verifyRequestOrigin } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { readGameState } from "@/lib/game-store";

// Ověří jednorázový QR přístup týmu a vrátí Firebase custom token.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 8192) {
    return NextResponse.json({ error: "Požadavek je příliš velký." }, { status: 413 });
  }

  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }

  if (typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) {
    return NextResponse.json({ error: "QR kód není platný." }, { status: 401 });
  }

  const tokenHash = createHash("sha256").update(body.token).digest("hex");
  // QR token se ověřuje přes hash, stejně jako přihlašovací relace.
  const [credential, card] = await Promise.all([
    getPrisma().teamQrCredential.findUnique({ where: { tokenHash } }),
    getPrisma().teamQrCard.findUnique({ where: { tokenHash } }),
  ]);
  const teamId = credential?.teamId ?? card?.teamId;
  if (!teamId) {
    if (card) {
      return NextResponse.json({ error: "Týmová QR kartička ještě nebyla přiřazena." }, { status: 409 });
    }
    return NextResponse.json({ error: "QR kód není platný nebo už byl zneplatněn." }, { status: 401 });
  }

  const state = await readGameState();
  if (!state.teams.some((team) => team.id === teamId)) {
    if (credential) await getPrisma().teamQrCredential.deleteMany({ where: { teamId } });
    if (card) await getPrisma().teamQrCard.updateMany({ where: { id: card.id }, data: { teamId: null } });
    return NextResponse.json({ error: "Tým už neexistuje." }, { status: 403 });
  }

  return NextResponse.json(
    { customToken: await createTeamCustomToken(teamId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

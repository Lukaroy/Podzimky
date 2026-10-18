import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, verifyRequestOrigin } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { readGameState } from "@/lib/game-store";

// Vytvoří nový jedinečný přihlašovací QR token pro zadaný tým.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> },
) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }

  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Přihlaste se jako administrátor." }, { status: 401 });
  }

  const { teamId } = await params;
  const state = await readGameState();
  if (!state.teams.some((team) => team.id === teamId)) {
    return NextResponse.json({ error: "Tým už neexistuje." }, { status: 404 });
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Uloží se jen hash; nový kód současně zneplatní předchozí QR týmu.
  await getPrisma().teamQrCredential.upsert({
    where: { teamId },
    create: { teamId, tokenHash },
    update: { tokenHash, createdAt: new Date() },
  });

  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}

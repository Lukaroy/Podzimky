import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { createTeamCustomToken } from "@/lib/firebase-admin";
import { verifyRequestOrigin } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { readGameState } from "@/lib/game-store";

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
  const credential = await getPrisma().teamQrCredential.findUnique({ where: { tokenHash } });
  if (!credential) {
    return NextResponse.json({ error: "QR kód není platný nebo už byl zneplatněn." }, { status: 401 });
  }

  const state = await readGameState();
  if (!state.teams.some((team) => team.id === credential.teamId)) {
    await getPrisma().teamQrCredential.deleteMany({ where: { teamId: credential.teamId } });
    return NextResponse.json({ error: "Tým už neexistuje." }, { status: 403 });
  }

  return NextResponse.json(
    { customToken: await createTeamCustomToken(credential.teamId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

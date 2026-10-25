import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, verifyRequestOrigin } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { readGameState } from "@/lib/game-store";

async function requireAdmin(request: Request) {
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "admin") {
    return { error: NextResponse.json({ error: "Přihlaste se jako administrátor." }, { status: 401 }) };
  }
  return { user };
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  const cards = await getPrisma().teamQrCard.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, teamId: true, createdAt: true },
  });
  return NextResponse.json(
    { cards: cards.map((card) => ({ ...card, createdAt: card.createdAt.toISOString() })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  if (Number(request.headers.get("content-length") ?? 0) > 8192) {
    return NextResponse.json({ error: "Požadavek je příliš velký." }, { status: 413 });
  }

  const token = randomBytes(32).toString("base64url");
  const card = await getPrisma().teamQrCard.create({
    data: {
      id: randomUUID(),
      tokenHash: createHash("sha256").update(token).digest("hex"),
    },
    select: { id: true, teamId: true, createdAt: true },
  });
  return NextResponse.json(
    { card: { ...card, createdAt: card.createdAt.toISOString() }, token },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;
  if (Number(request.headers.get("content-length") ?? 0) > 8192) {
    return NextResponse.json({ error: "Požadavek je příliš velký." }, { status: 413 });
  }

  let body: { cardId?: unknown; teamId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  if (typeof body.cardId !== "string" || typeof body.teamId !== "string") {
    return NextResponse.json({ error: "Vyberte QR kartičku a tým." }, { status: 400 });
  }

  const state = await readGameState();
  if (!state.teams.some((team) => team.id === body.teamId)) {
    return NextResponse.json({ error: "Tým už neexistuje." }, { status: 404 });
  }
  if (await getPrisma().teamQrCard.findUnique({ where: { teamId: body.teamId }, select: { id: true } })) {
    return NextResponse.json({ error: "Tým už má přiřazenou QR kartičku." }, { status: 409 });
  }
  const result = await getPrisma().teamQrCard.updateMany({
    where: { id: body.cardId, teamId: null },
    data: { teamId: body.teamId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Kartička už byla přiřazena nebo neexistuje." }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const auth = await requireAdmin(request);
  if (auth.error) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Chybí QR kartička." }, { status: 400 });
  const result = await getPrisma().teamQrCard.deleteMany({ where: { id, teamId: null } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Přiřazenou nebo neexistující kartičku nelze odebrat." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

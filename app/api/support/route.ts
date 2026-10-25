import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, verifyRequestOrigin } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { readGameState } from "@/lib/game-store";

// Vrátí jen vlastní zprávy týmu, nebo všechny konverzace pro správce.
export async function GET(request: Request) {
  const user = await getSession(getSessionToken(request));
  if (!user) {
    return NextResponse.json({ error: "Přihlášení vypršelo." }, { status: 401 });
  }

  const messages = await getPrisma().supportMessage.findMany({
    ...(user.role === "team" ? { where: { teamId: user.teamId } } : {}),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
}

// Uloží zprávu pod identitou ověřeného týmu nebo správce.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }

  const user = await getSession(getSessionToken(request));
  if (!user) {
    return NextResponse.json({ error: "Přihlášení vypršelo." }, { status: 401 });
  }

  let body: { content?: unknown; teamId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Zpráva není platný požadavek." }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "Zadejte text zprávy." }, { status: 400 });
  }
  const content = body.content.trim();
  if (!content || content.length > 2_000) {
    return NextResponse.json({ error: "Zpráva musí mít 1 až 2 000 znaků." }, { status: 400 });
  }

  const teamId = user.role === "team" ? user.teamId : body.teamId;
  if (typeof teamId !== "string") {
    return NextResponse.json({ error: "Vyberte tým konverzace." }, { status: 400 });
  }

  const state = await readGameState();
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) {
    return NextResponse.json({ error: "Tým už není dostupný." }, { status: 404 });
  }

  const message = await getPrisma().supportMessage.create({
    data: {
      id: randomUUID(),
      teamId: team.id,
      teamName: team.name,
      senderRole: user.role,
      content,
    },
  });

  return NextResponse.json({ message }, { status: 201 });
}

// Smaže konverzaci jednoho týmu, nebo všechny konverzace; smí to jen hlavní admin.
export async function DELETE(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Přihlaste se jako administrátor." }, { status: 401 });
  }
  if (user.managerId) {
    return NextResponse.json({ error: "Chat může mazat pouze hlavní administrátor." }, { status: 403 });
  }

  let body: { teamId?: unknown; all?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  if (body.all !== true && typeof body.teamId !== "string") {
    return NextResponse.json({ error: "Vyberte konverzaci ke smazání." }, { status: 400 });
  }

  const result = await getPrisma().supportMessage.deleteMany({
    ...(body.all === true ? {} : { where: { teamId: body.teamId as string } }),
  });
  return NextResponse.json({ deleted: result.count });
}

import { NextResponse } from "next/server";

import { getSession, getSessionToken, verifyRequestOrigin } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { readGameState } from "@/lib/game-store";

export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }

  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "team") {
    return NextResponse.json({ error: "Přihlaste se jako tým." }, { status: 401 });
  }

  let body: { latitude?: unknown; longitude?: unknown; accuracy?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatná poloha." }, { status: 400 });
  }

  const { latitude, longitude, accuracy } = body;
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    (accuracy !== undefined && (
      typeof accuracy !== "number" ||
      !Number.isFinite(accuracy) ||
      accuracy < 0 ||
      accuracy > 100_000
    ))
  ) {
    return NextResponse.json({ error: "Souřadnice nejsou platné." }, { status: 400 });
  }

  const state = await readGameState();
  if (!state.gameStartedAt || state.gameStoppedAt || state.gameClosedAt) {
    return NextResponse.json({ error: "Poloha se ukládá jen během probíhající hry." }, { status: 409 });
  }
  if (!state.teams.some((team) => team.id === user.teamId)) {
    return NextResponse.json({ error: "Tým už ve hře není." }, { status: 404 });
  }

  await getPrisma().teamLocation.upsert({
    where: { teamId: user.teamId },
    create: {
      teamId: user.teamId,
      latitude,
      longitude,
      accuracy: typeof accuracy === "number" ? accuracy : null,
    },
    update: {
      latitude,
      longitude,
      accuracy: typeof accuracy === "number" ? accuracy : null,
    },
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

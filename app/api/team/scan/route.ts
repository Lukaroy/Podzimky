import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, verifyRequestOrigin } from "@/lib/auth";
import { updateGameState, type GameState, type Station } from "@/lib/game-store";

// Ověří UID stanoviště a otevře týmu právě následující úsek trasy.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "team") {
    return NextResponse.json({ error: "Přihlaste se jako tým." }, { status: 401 });
  }

  let uid: unknown;
  try {
    ({ uid } = await request.json());
  } catch {
    return NextResponse.json({ error: "Neplatný QR kód." }, { status: 400 });
  }
  if (typeof uid !== "string" || !/^[A-Z0-9]{8}$/i.test(uid.trim())) {
    return NextResponse.json({ error: "UID musí mít přesně 8 písmen nebo číslic." }, { status: 400 });
  }

  let state: GameState;
  let scannedStation: Omit<Station, "answer"> | undefined;
  try {
    // Kontrola pořadí i zaznamenání skenu jsou chráněné souběžnou aktualizací.
    state = await updateGameState((current) => {
      if (current.gameClosedAt) throw new Error("Hra je uzavřená.");
      if (current.gameStoppedAt) throw new Error("Hra byla ukončena.");
      const team = current.teams.find((item) => item.id === user.teamId);
      const station = current.stations.find((item) => item.uid.toUpperCase() === uid.trim().toUpperCase());
      if (!team || !station) throw new Error("QR kód nebyl rozpoznán.");
      const safeStation = { ...station };
      delete safeStation.answer;
      scannedStation = safeStation;
      if (team.completedStations.includes(station.id)) return current;
      const nextOrder = Math.max(
        ...current.stations
          .filter((item) => team.completedStations.includes(item.id))
          .map((item) => item.order),
        0,
      ) + 1;
      // QR lze použít jen pro další nevyřízené stanoviště v trase.
      if (station.order !== nextOrder) throw new Error("Nejdříve dokončete předchozí stanoviště.");
      if (current.submissions.some((item) => item.teamId === team.id && item.stationId === station.id && item.status === "pending")) {
        throw new Error("Úkol už čeká na schválení.");
      }
      if (team.scannedStationIds.includes(station.id)) return current;

      return {
        ...current,
        teams: current.teams.map((item) =>
          item.id === team.id
            ? { ...item, scannedStationIds: [...item.scannedStationIds, station.id] }
            : item,
        ),
        events: [
          {
            id: randomUUID(),
            teamId: team.id,
            message: `Tým ${team.name} naskenoval stanoviště ${station.title}.`,
            tone: "info" as const,
            createdAt: new Date().toISOString(),
          },
          ...current.events,
        ].slice(0, 12),
      };
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "QR kód se nepodařilo ověřit." },
      { status: 400 },
    );
  }

  const team = state.teams.find((item) => item.id === user.teamId);
  return NextResponse.json({
    ok: true,
    team: team ? { ...team, password: "" } : undefined,
    station: scannedStation,
    events: state.events.filter((event) => !event.teamId || event.teamId === user.teamId),
  });
}

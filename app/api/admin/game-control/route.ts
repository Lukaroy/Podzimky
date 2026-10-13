import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, sanitizeGameState, verifyRequestOrigin } from "@/lib/auth";
import { updateGameState } from "@/lib/game-store";

export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Přihlaste se jako administrátor." }, { status: 401 });
  }

  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný příkaz." }, { status: 400 });
  }
  if (body.action !== "start" && body.action !== "restart") {
    return NextResponse.json({ error: "Neznámý příkaz pro řízení hry." }, { status: 400 });
  }

  try {
    const state = await updateGameState((current) => {
      if (body.action === "start") {
        if (current.gameStartedAt) throw new Error("Hra už běží. Pro nový start použijte restart času a postupu.");
        if (current.teams.length === 0) throw new Error("Před startem vytvořte alespoň jeden tým.");
        const gameStartedAt = new Date().toISOString();
        return {
          ...current,
          gameStartedAt,
          events: [
            {
              id: randomUUID(),
              message: "Hra byla společně odstartována.",
              tone: "success" as const,
              createdAt: gameStartedAt,
            },
            ...current.events,
          ].slice(0, 12),
        };
      }

      const restartedAt = new Date().toISOString();
      return {
        ...current,
        gameStartedAt: restartedAt,
        teams: current.teams.map((team) => ({
          ...team,
          completedStations: [],
          scannedStationIds: [],
          flashMissionId: undefined,
        })),
        submissions: current.submissions.map((submission) => ({
          ...submission,
          archivedAt: submission.archivedAt ?? restartedAt,
        })),
        flashMissions: current.flashMissions.map((mission) => ({
          ...mission,
          archivedAt: mission.archivedAt ?? restartedAt,
        })),
        events: [
          {
            id: randomUUID(),
            message: "Hra byla restartována. Postup byl vynulován a důkazy archivovány.",
            tone: "warning" as const,
            createdAt: restartedAt,
          },
          ...current.events,
        ].slice(0, 12),
      };
    });
    return NextResponse.json({ ok: true, state: sanitizeGameState(state, user) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Hru se nepodařilo spustit." },
      { status: 409 },
    );
  }
}

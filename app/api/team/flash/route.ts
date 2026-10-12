import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, sanitizeGameState, verifyRequestOrigin } from "@/lib/auth";
import { updateGameState } from "@/lib/game-store";

export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "team") {
    return NextResponse.json({ error: "Přihlaste se jako tým." }, { status: 401 });
  }

  let state;
  try {
    state = await updateGameState((current) => {
      const team = current.teams.find((item) => item.id === user.teamId);
      if (!team?.flashMissionId) throw new Error("Tým nemá aktivní přepadový úkol.");
      const mission = current.flashMissions.find((item) => item.id === team.flashMissionId);
      if (!mission || !mission.targetTeamIds.includes(team.id)) {
        throw new Error("Přepadový úkol už není dostupný tomuto týmu.");
      }
      return {
        ...current,
        teams: current.teams.map((item) =>
          item.id === team.id ? { ...item, flashMissionId: undefined } : item,
        ),
        flashMissions: current.flashMissions.filter((item) => item.id !== mission.id),
        events: [
          {
            id: randomUUID(),
            teamId: team.id,
            message: `Tým ${team.name} dokončil přepadový úkol.`,
            tone: "success" as const,
            createdAt: new Date().toISOString(),
          },
          ...current.events,
        ].slice(0, 12),
      };
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Přepadový úkol se nepodařilo dokončit." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, state: sanitizeGameState(state, user) });
}

import { NextResponse } from "next/server";

import { getSession, getSessionToken } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { readGameState } from "@/lib/game-store";

export async function GET(request: Request) {
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Přihlaste se jako administrátor." }, { status: 401 });
  }
  if (user.managerId) {
    return NextResponse.json({ error: "Mapa poloh je dostupná jen hlavnímu administrátorovi." }, { status: 403 });
  }

  const state = await readGameState();
  if (!state.gameStartedAt) {
    return NextResponse.json({ locations: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const teamsById = new Map(state.teams.map((team) => [team.id, team.name]));
  if (teamsById.size === 0) {
    return NextResponse.json({ locations: [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const locations = await getPrisma().teamLocation.findMany({
    where: {
      teamId: { in: [...teamsById.keys()] },
      updatedAt: { gte: new Date(state.gameStartedAt) },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    locations: locations.map((location) => ({
      teamId: location.teamId,
      teamName: teamsById.get(location.teamId) ?? "Neznámý tým",
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      updatedAt: location.updatedAt.toISOString(),
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

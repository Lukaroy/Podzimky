import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, sanitizeGameState, verifyRequestOrigin } from "@/lib/auth";
import { updateGameState, type Submission } from "@/lib/game-store";

export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "team") {
    return NextResponse.json({ error: "Přihlaste se jako tým." }, { status: 401 });
  }

  let body: { content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatné odevzdání." }, { status: 400 });
  }
  if (typeof body.content !== "string" || !body.content.trim() || body.content.trim().length > 10_000) {
    return NextResponse.json({ error: "Napište odpověď (maximálně 10 000 znaků)." }, { status: 400 });
  }
  const answer = body.content.trim();

  let submission: Submission | undefined;
  try {
    const state = await updateGameState((current) => {
      const team = current.teams.find((item) => item.id === user.teamId);
      if (!team?.flashMissionId) throw new Error("Tým nemá aktivní přepadový úkol.");
      const mission = current.flashMissions.find((item) => item.id === team.flashMissionId);
      if (!mission || !mission.targetTeamIds.includes(team.id)) {
        throw new Error("Přepadový úkol už není dostupný tomuto týmu.");
      }
      if (current.submissions.some((item) => item.missionId === mission.id && item.teamId === team.id && item.status === "pending")) {
        throw new Error("Odpověď už čeká na schválení.");
      }

      submission = {
        id: randomUUID(),
        stationId: "",
        missionId: mission.id,
        teamId: team.id,
        status: mission.requiresApproval ? "pending" : "approved",
        content: mission.description,
        evidence: answer,
        comment: "",
        createdAt: new Date().toISOString(),
      };
      const teams = mission.requiresApproval
        ? current.teams
        : current.teams.map((item) =>
            item.id === team.id ? { ...item, flashMissionId: undefined } : item,
          );
      const missionStillAssigned = teams.some((item) => item.flashMissionId === mission.id);
      return {
        ...current,
        teams,
        flashMissions: mission.requiresApproval || missionStillAssigned
          ? current.flashMissions
          : current.flashMissions.filter((item) => item.id !== mission.id),
        submissions: [...current.submissions, submission],
        events: [
          {
            id: randomUUID(),
            teamId: team.id,
            message: mission.requiresApproval
              ? `Tým ${team.name} odeslal odpověď k přepadovému úkolu ${mission.title}.`
              : `Tým ${team.name} splnil přepadový úkol ${mission.title}.`,
            tone: mission.requiresApproval ? "warning" as const : "success" as const,
            createdAt: new Date().toISOString(),
          },
          ...current.events,
        ].slice(0, 12),
      };
    });
    return NextResponse.json({ ok: true, submission, state: sanitizeGameState(state, user) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Přepadový úkol se nepodařilo odeslat." },
      { status: 400 },
    );
  }
}

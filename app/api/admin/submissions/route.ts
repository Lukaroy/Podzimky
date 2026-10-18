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

  let body: { submissionId?: unknown; status?: unknown; comment?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatné rozhodnutí." }, { status: 400 });
  }
  if (
    typeof body.submissionId !== "string" ||
    (body.status !== "approved" && body.status !== "rejected") ||
    (body.comment !== undefined && typeof body.comment !== "string")
  ) {
    return NextResponse.json({ error: "Neplatné rozhodnutí." }, { status: 400 });
  }
  const status = body.status;
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 500) : undefined;

  try {
    const state = await updateGameState((current) => {
      if (current.gameClosedAt) throw new Error("Hra už je uzavřená.");
      const submission = current.submissions.find((item) => item.id === body.submissionId);
      if (!submission || submission.status !== "pending" || submission.archivedAt) {
        throw new Error("Odevzdání už není dostupné ke schválení.");
      }
      const station = submission.missionId
        ? undefined
        : current.stations.find((item) => item.id === submission.stationId);
      const mission = submission.missionId
        ? current.flashMissions.find((item) => item.id === submission.missionId)
        : undefined;
      if (mission?.archivedAt) throw new Error("Odevzdání bylo archivováno při restartu hry.");
      if (!station && !mission) throw new Error("Úkol už neexistuje.");
      const team = current.teams.find((item) => item.id === submission.teamId);
      if (!team) throw new Error("Tým už neexistuje.");

      const approved = status === "approved";
      const teams = approved && station
        ? current.teams.map((item) =>
            item.id === team.id && !item.completedStations.includes(station.id)
              ? { ...item, completedStations: [...item.completedStations, station.id] }
              : item,
          )
        : approved && mission
          ? current.teams.map((item) =>
              item.id === team.id ? { ...item, flashMissionId: undefined } : item,
            )
          : current.teams;
      const missionStillAssigned = mission && teams.some((item) => item.flashMissionId === mission.id);
      const now = new Date().toISOString();

      return {
        ...current,
        teams,
        flashMissions: approved && mission && !missionStillAssigned
          ? current.flashMissions.filter((item) => item.id !== mission.id)
          : current.flashMissions,
        submissions: current.submissions.map((item) =>
          item.id === submission.id
            ? { ...item, status, comment: comment ?? item.comment }
            : item,
        ),
        events: [
          {
            id: randomUUID(),
            teamId: team.id,
            message: approved
              ? `Admin schválil úkol ${station?.title ?? mission?.title ?? ""} pro tým ${team.name}.`
              : `Admin zamítl úkol ${station?.title ?? mission?.title ?? ""} pro tým ${team.name}.`,
            tone: approved ? "success" as const : "warning" as const,
            createdAt: now,
          },
          ...current.events,
        ].slice(0, 12),
      };
    });
    return NextResponse.json({ ok: true, state: sanitizeGameState(state, user) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Odevzdání se nepodařilo zpracovat." },
      { status: 400 },
    );
  }
}

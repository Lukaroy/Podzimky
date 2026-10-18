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

  let body: { targetTeamId?: unknown; title?: unknown; description?: unknown; type?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný přepad." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (
    typeof body.targetTeamId !== "string" ||
    !title ||
    title.length > 100 ||
    !description ||
    description.length > 2000 ||
    (body.type !== "photo" && body.type !== "video")
  ) {
    return NextResponse.json({ error: "Vyplňte cíl, název, zadání a typ důkazu přepadu." }, { status: 400 });
  }
  const type: "photo" | "video" = body.type === "video" ? "video" : "photo";

  try {
    const state = await updateGameState((current) => {
      if (!current.gameStartedAt) throw new Error("Přepad lze poslat až po startu hry.");
      if (current.gameStoppedAt) throw new Error("Hra je pozastavená.");
      if (current.gameClosedAt) throw new Error("Hra je uzavřená.");

      const sender = current.teams.find((team) => team.id === user.teamId);
      const target = current.teams.find((team) => team.id === body.targetTeamId);
      if (!sender || !target || sender.id === target.id) {
        throw new Error("Vyberte platný soupeřící tým.");
      }
      if ((sender.flashMissionsUsed ?? 0) >= 3) {
        throw new Error("Tým už vyčerpal všechny 3 přepady.");
      }
      if (target.flashMissionId) {
        throw new Error("Vybraný tým už řeší jiný přepad.");
      }

      const now = new Date().toISOString();
      const missionId = `mission-${randomUUID()}`;
      const mission = {
        id: missionId,
        title,
        description,
        type,
        targetMode: "specific" as const,
        targetTeamIds: [target.id],
        requiresApproval: false,
        instructions: "Toto je týmový přepad. Odešlete požadovanou fotografii nebo video.",
        sourceTeamId: sender.id,
        sourceTeamName: sender.name,
      };
      const senderEvent = {
        id: randomUUID(),
        teamId: sender.id,
        message: `Tým ${sender.name} poslal přepad týmu ${target.name}: ${title}.`,
        tone: "warning" as const,
        createdAt: now,
      };
      const targetEvent = {
        id: randomUUID(),
        teamId: target.id,
        message: `Tým ${sender.name} vás přepadl: ${title}.`,
        tone: "warning" as const,
        createdAt: now,
      };

      return {
        ...current,
        teams: current.teams.map((team) => {
          if (team.id === sender.id) {
            return { ...team, flashMissionsUsed: (team.flashMissionsUsed ?? 0) + 1 };
          }
          if (team.id === target.id) return { ...team, flashMissionId: missionId };
          return team;
        }),
        flashMissions: [...current.flashMissions, mission],
        events: [targetEvent, senderEvent, ...current.events].slice(0, 12),
      };
    });
    return NextResponse.json({ ok: true, state: sanitizeGameState(state, user) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Přepad se nepodařilo odeslat." },
      { status: 409 },
    );
  }
}

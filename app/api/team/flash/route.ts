import { randomUUID } from "node:crypto";
import { head } from "@vercel/blob";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, sanitizeGameState, verifyRequestOrigin } from "@/lib/auth";
import { updateGameState, type Submission } from "@/lib/game-store";

const MEDIA_URL_PATTERN = /^\/api\/media\/(team-[A-Za-z0-9_-]{1,128}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|avif|mp4|webm|mov))$/i;
const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "team") {
    return NextResponse.json({ error: "Přihlaste se jako tým." }, { status: 401 });
  }

  let body: { content?: unknown; mediaUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatné odevzdání." }, { status: 400 });
  }
  if (
    (body.content !== undefined && typeof body.content !== "string") ||
    (body.mediaUrl !== undefined && typeof body.mediaUrl !== "string") ||
    (typeof body.content === "string" && body.content.length > 10_000)
  ) {
    return NextResponse.json({ error: "Neplatné odevzdání." }, { status: 400 });
  }
  const answer = typeof body.content === "string" ? body.content.trim() : "";
  let mediaUrl: string | undefined;
  if (typeof body.mediaUrl === "string") {
    const match = MEDIA_URL_PATTERN.exec(body.mediaUrl);
    if (!match) return NextResponse.json({ error: "Přepadový úkol přijímá pouze fotografii nebo video." }, { status: 400 });
    const pathname = match[1];
    if (!pathname.startsWith(`team-${user.teamId}/`)) {
      return NextResponse.json({ error: "Nahraný soubor nepatří tomuto týmu." }, { status: 403 });
    }
    const extension = pathname.split(".").at(-1)?.toLowerCase() ?? "";
    try {
      const blob = await head(pathname);
      if (blob.size === 0 || blob.size > 50 * 1024 * 1024 || blob.contentType !== MEDIA_TYPES[extension]) {
        return NextResponse.json({ error: "Nahraný soubor neodpovídá povolenému formátu nebo velikosti." }, { status: 400 });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "BlobNotFoundError") {
        return NextResponse.json({ error: "Nahraná fotografie nebyla nalezena." }, { status: 400 });
      }
      throw error;
    }
    mediaUrl = `/api/media/${pathname}`;
  }

  let submission: Submission | undefined;
  try {
    const state = await updateGameState((current) => {
      if (current.gameClosedAt) throw new Error("Hra je uzavřená.");
      if (current.gameStoppedAt) throw new Error("Hra je pozastavena.");
      const team = current.teams.find((item) => item.id === user.teamId);
      if (!team?.flashMissionId) throw new Error("Tým nemá aktivní přepadový úkol.");
      const mission = current.flashMissions.find((item) => item.id === team.flashMissionId);
      if (!mission || mission.archivedAt || !mission.targetTeamIds.includes(team.id)) {
        throw new Error("Přepadový úkol už není dostupný tomuto týmu.");
      }
      if (mediaUrl) {
        const isVideo = /\.(mp4|webm|mov)$/i.test(mediaUrl);
        if ((mission.type === "video") !== isVideo) {
          throw new Error(mission.type === "video"
            ? "K tomuto úkolu nahrajte video."
            : "K tomuto úkolu nahrajte fotografii.");
        }
      }
      if (mission.type !== "photo" && mission.type !== "video" && mission.type !== "text") {
        throw new Error("Tento typ přepadového úkolu není podporovaný.");
      }
      if ((mission.type === "photo" || mission.type === "video") && !mediaUrl) {
        throw new Error(mission.type === "video" ? "Nahrajte video k přepadovému úkolu." : "Nahrajte fotografii k přepadovému úkolu.");
      }
      if (mission.type === "text" && (!answer || answer.length > 10_000)) {
        throw new Error("Napište odpověď (maximálně 10 000 znaků).");
      }
      if (mission.type === "text" && mediaUrl) throw new Error("Tento přepadový úkol nepřijímá soubor.");
      if (current.submissions.some((item) =>
        item.missionId === mission.id &&
        item.teamId === team.id &&
        item.status === "pending" &&
        !item.archivedAt
      )) {
        throw new Error("Odpověď už čeká na schválení.");
      }

      submission = {
        id: randomUUID(),
        stationId: "",
        missionId: mission.id,
        teamId: team.id,
        status: mission.requiresApproval ? "pending" : "approved",
        content: mission.description,
        evidence: mediaUrl ?? answer,
        ...(mediaUrl ? { mediaUrl } : {}),
        comment: "",
        createdAt: new Date().toISOString(),
      };
      const now = new Date().toISOString();
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
          : mission.sourceTeamId
            ? current.flashMissions.map((item) =>
                item.id === mission.id ? { ...item, archivedAt: now } : item,
              )
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
            createdAt: now,
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

import { randomUUID } from "node:crypto";
import { head } from "@vercel/blob";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, verifyRequestOrigin } from "@/lib/auth";
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

// Ověří a uloží odpověď nebo mediální důkaz týmu ke stanovišti.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "team") {
    return NextResponse.json({ error: "Přihlaste se jako tým." }, { status: 401 });
  }

  let body: { stationId?: unknown; content?: unknown; mediaUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatné odevzdání." }, { status: 400 });
  }
  if (
    typeof body.stationId !== "string" ||
    (body.content !== undefined && typeof body.content !== "string") ||
    (body.mediaUrl !== undefined && typeof body.mediaUrl !== "string")
  ) {
    return NextResponse.json({ error: "Neplatné odevzdání." }, { status: 400 });
  }

  let mediaUrl: string | undefined;
  if (typeof body.mediaUrl === "string") {
    const match = MEDIA_URL_PATTERN.exec(body.mediaUrl);
    if (!match) return NextResponse.json({ error: "Neplatný soubor." }, { status: 400 });
    const pathname = match[1];
    if (!pathname.startsWith(`team-${user.teamId}/`)) {
      return NextResponse.json({ error: "Nahraný soubor nepatří tomuto týmu." }, { status: 403 });
    }
    const extension = pathname.split(".").at(-1)?.toLowerCase() ?? "";
    try {
      const blob = await head(pathname);
      if (
        blob.size === 0 ||
        blob.size > 100 * 1024 * 1024 ||
        blob.contentType !== MEDIA_TYPES[extension]
      ) {
        return NextResponse.json({ error: "Nahraný soubor neodpovídá povolenému formátu nebo velikosti." }, { status: 400 });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "BlobNotFoundError") {
        return NextResponse.json({ error: "Nahraný soubor nebyl nalezen." }, { status: 400 });
      }
      throw error;
    }
    mediaUrl = `/api/media/${pathname}`;
  }

  let submission: Submission | undefined;
  let updatedTeam: { id: string; completedStations: string[]; scannedStationIds: string[] } | undefined;
  try {
    // Server kontroluje aktuální trasu, typ úkolu a důkaz v jedné aktualizaci.
    const nextState = await updateGameState((current) => {
      if (!current.gameStartedAt) throw new Error("Hra ještě nezačala.");
      if (current.gameClosedAt) throw new Error("Hra je uzavřená.");
      if (current.gameStoppedAt) throw new Error("Hra byla ukončena.");
      const team = current.teams.find((item) => item.id === user.teamId);
      const station = current.stations.find((item) => item.id === body.stationId);
      if (!team || !station) throw new Error("Stanoviště nebylo nalezeno.");
      if (!team.scannedStationIds.includes(station.id)) throw new Error("Nejdříve naskenujte QR kód stanoviště.");
      const nextOrder = Math.max(
        ...current.stations
          .filter((item) => team.completedStations.includes(item.id))
          .map((item) => item.order),
        0,
      ) + 1;
      if (station.order !== nextOrder) throw new Error("Toto stanoviště teď není dostupné.");
      if (current.submissions.some((item) =>
        item.teamId === team.id &&
        item.stationId === station.id &&
        item.status === "pending" &&
        !item.archivedAt
      )) {
        throw new Error("Úkol už čeká na schválení.");
      }

      const requiresMedia = station.type === "photo" || station.type === "video";
      // Typ souboru i odpověď kontroluje server, klientská validace sama nestačí.
      const hasExpectedMedia = mediaUrl && (station.type === "photo"
        ? /\.(jpg|png|webp|gif|avif)$/i.test(mediaUrl)
        : station.type === "video" && /\.(mp4|webm|mov)$/i.test(mediaUrl));
      if (requiresMedia && !hasExpectedMedia) throw new Error("Nahrajte soubor požadovaného typu.");
      if (!requiresMedia && mediaUrl) throw new Error("Toto stanoviště nepřijímá soubor.");
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!requiresMedia && (!content || content.length > 10_000)) {
        throw new Error("Vyplňte odpověď (maximálně 10 000 znaků).");
      }
      if (station.type === "form") {
        let answers: Record<string, unknown>;
        try {
          answers = JSON.parse(content) as Record<string, unknown>;
        } catch {
          throw new Error("Formulář neobsahuje platné odpovědi.");
        }
        const questions = station.formQuestions ?? [];
        if (
          questions.length === 0 ||
          questions.some((question) => {
            const answer = answers[question.id];
            if (typeof answer !== "string" || !answer.trim()) return true;
            if (question.type === "multiple-choice" && !question.options?.includes(answer)) return true;
            if (question.type === "number" && !Number.isFinite(Number(answer))) return true;
            return false;
          })
        ) {
          throw new Error("Vyplňte všechny položky formuláře.");
        }
      }
      if (station.type === "multiple-choice" && !station.options?.includes(content)) {
        throw new Error("Vyberte jednu z dostupných odpovědí.");
      }
      if (station.answer) {
        const normalizeAnswer = (value: string) =>
          value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
        if (normalizeAnswer(content) !== normalizeAnswer(station.answer)) {
          throw new Error("Odpověď není správná. Zkuste to znovu.");
        }
      }

      submission = {
        id: randomUUID(),
        stationId: station.id,
        teamId: team.id,
        status: station.requiresApproval ? "pending" : "approved",
        content,
        evidence: mediaUrl ? "Soubor nahrán" : content,
        ...(mediaUrl ? { mediaUrl } : {}),
        comment: "",
        createdAt: new Date().toISOString(),
      };
      updatedTeam = {
        id: team.id,
        completedStations: station.requiresApproval
          ? team.completedStations
          : [...new Set([...team.completedStations, station.id])],
        scannedStationIds: team.scannedStationIds,
      };
      return {
        ...current,
        teams: current.teams.map((item) =>
          item.id === team.id && !station.requiresApproval
            ? { ...item, completedStations: updatedTeam?.completedStations ?? item.completedStations }
            : item,
        ),
        submissions: [...current.submissions, submission],
        events: [
          {
            id: randomUUID(),
            teamId: team.id,
            message: station.requiresApproval
              ? `Tým ${team.name} odeslal úkol ze stanoviště ${station.title}.`
              : `Tým ${team.name} splnil stanoviště ${station.title}.`,
            tone: station.requiresApproval ? "warning" as const : "success" as const,
            createdAt: new Date().toISOString(),
          },
          ...current.events,
        ].slice(0, 12),
      };
    });
    const persistedTeam = nextState.teams.find((item) => item.id === user.teamId);
    if (persistedTeam) updatedTeam = {
      id: persistedTeam.id,
      completedStations: persistedTeam.completedStations,
      scannedStationIds: persistedTeam.scannedStationIds,
    };
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Úkol se nepodařilo odeslat." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, submission, team: updatedTeam });
}

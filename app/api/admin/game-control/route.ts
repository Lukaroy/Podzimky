import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, sanitizeGameState, verifyRequestOrigin } from "@/lib/auth";
import { updateGameState } from "@/lib/game-store";

// Spustí, pozastaví, obnoví nebo restartuje hru pro hlavního administrátora.
export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Přihlaste se jako administrátor." }, { status: 401 });
  }
  if (user.managerId) {
    return NextResponse.json({ error: "Hru může ovládat pouze hlavní administrátor." }, { status: 403 });
  }

  // Ovládání času a restart zůstávají vyhrazené hlavnímu administrátorovi.
  let body: { action?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný příkaz." }, { status: 400 });
  }
  if (body.action !== "start" && body.action !== "restart" && body.action !== "stop" && body.action !== "resume") {
    return NextResponse.json({ error: "Neznámý příkaz pro řízení hry." }, { status: 400 });
  }

  try {
    // Všechny přechody stavu se počítají nad aktuálním záznamem v databázi.
    const state = await updateGameState((current) => {
      if (current.gameClosedAt) throw new Error("Hra už je uzavřená.");
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

      if (body.action === "stop" || body.action === "resume") {
        if (!current.gameStartedAt) throw new Error("Hra ještě nezačala.");
        const now = new Date().toISOString();
        const stopping = body.action === "stop";
        if (stopping && current.gameStoppedAt) throw new Error("Čas už je zastavený.");
        if (!stopping && !current.gameStoppedAt) throw new Error("Čas není zastavený.");
        const pausedMs = stopping
          ? current.gamePausedMs
          : (current.gamePausedMs ?? 0) + Math.max(0, Date.parse(now) - Date.parse(current.gameStoppedAt!));
        return {
          ...current,
          gameStoppedAt: stopping ? now : undefined,
          gamePausedMs: pausedMs,
          events: [
            {
              id: randomUUID(),
              message: stopping ? "Čas hry byl zastaven." : "Čas hry byl znovu spuštěn.",
              tone: stopping ? ("warning" as const) : ("success" as const),
              createdAt: now,
            },
            ...current.events,
          ].slice(0, 12),
        };
      }

      const restartedAt = new Date().toISOString();
      // Restart zachová historii důkazů archivovanou, ale vynuluje týmům postup i přepady.
      return {
        ...current,
        gameStartedAt: restartedAt,
        gameStoppedAt: undefined,
        gamePausedMs: 0,
        teams: current.teams.map((team) => ({
          ...team,
          completedStations: [],
          scannedStationIds: [],
          flashMissionId: undefined,
          flashMissionsUsed: 0,
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

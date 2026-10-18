import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { getSession, getSessionToken, sanitizeGameState, verifyRequestOrigin } from "@/lib/auth";
import { updateGameState } from "@/lib/game-store";

type OwnerAction =
  | { action: "emergency-message"; message: string }
  | { action: "clear-emergency-message" }
  | { action: "intervene"; teamId: string; stationId: string; completed: boolean }
  | { action: "close-game" };

export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Přihlaste se jako administrátor." }, { status: 401 });
  }
  if (user.managerId) {
    return NextResponse.json({ error: "Tuto akci může provést pouze hlavní administrátor." }, { status: 403 });
  }

  let body: Partial<OwnerAction>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Neplatný příkaz." }, { status: 400 });
  }

  if (
    (body.action === "emergency-message" &&
      (typeof body.message !== "string" || body.message.trim().length === 0 || body.message.length > 500)) ||
    (body.action === "intervene" &&
      (typeof body.teamId !== "string" ||
        typeof body.stationId !== "string" ||
        typeof body.completed !== "boolean")) ||
    !["emergency-message", "clear-emergency-message", "intervene", "close-game"].includes(body.action ?? "")
  ) {
    return NextResponse.json({ error: "Neplatné nebo neúplné zadání." }, { status: 400 });
  }

  try {
    const state = await updateGameState((current) => {
      if (current.gameClosedAt) throw new Error("Hra už je uzavřená.");
      const now = new Date().toISOString();

      if (body.action === "emergency-message") {
        const message = body.message!.trim();
        return {
          ...current,
          emergencyMessage: { message, createdAt: now },
          events: [
            { id: randomUUID(), message: "Hlavní admin odeslal nouzovou zprávu všem týmům.", tone: "warning" as const, createdAt: now },
            ...current.events,
          ].slice(0, 12),
        };
      }

      if (body.action === "clear-emergency-message") {
        return { ...current, emergencyMessage: undefined };
      }

      if (body.action === "intervene") {
        const team = current.teams.find((item) => item.id === body.teamId);
        const station = current.stations.find((item) => item.id === body.stationId);
        if (!team || !station) throw new Error("Vybraný tým nebo stanoviště už neexistuje.");
        const orderedStations = [...current.stations].sort((first, second) => first.order - second.order);
        const stationOrder = station.order;
        const completedStations = body.completed
          ? [...new Set([
              ...team.completedStations,
              ...orderedStations.filter((item) => item.order <= stationOrder).map((item) => item.id),
            ])]
          : team.completedStations.filter((id) => {
              const completed = current.stations.find((item) => item.id === id);
              return completed && completed.order < stationOrder;
            });
        const scannedStationIds = body.completed
          ? team.scannedStationIds
          : team.scannedStationIds.filter((id) => {
              const scanned = current.stations.find((item) => item.id === id);
              return scanned && scanned.order < stationOrder;
            });
        const archivedAt = now;

        return {
          ...current,
          teams: current.teams.map((item) => item.id === team.id
            ? {
                ...item,
                completedStations,
                scannedStationIds,
                progressVersion: (item.progressVersion ?? 0) + 1,
              }
            : item),
          submissions: current.submissions.map((submission) => {
                const submittedStation = current.stations.find((item) => item.id === submission.stationId);
                if (
                  submission.teamId !== team.id ||
                  !submittedStation ||
                  submission.status !== "pending" ||
                  submission.archivedAt
                ) return submission;
                if (body.completed && submittedStation.order <= stationOrder) {
                  return { ...submission, status: "approved" as const, comment: "Ruční zásah hlavního administrátora." };
                }
                if (!body.completed && submittedStation.order >= stationOrder) {
                  return { ...submission, archivedAt };
                }
                return submission;
              }),
          events: [
            {
              id: randomUUID(),
              teamId: team.id,
              message: `Hlavní admin ${body.completed ? "splnil" : "vrátil"} týmu ${team.name} stanoviště ${station.title}.`,
              tone: "warning" as const,
              createdAt: now,
            },
            ...current.events,
          ].slice(0, 12),
        };
      }

      if (!current.gameStartedAt) throw new Error("Hru lze uzavřít až po jejím spuštění.");
      const ranked = [...current.teams]
        .map((team) => ({ teamId: team.id, teamName: team.name, completedStations: team.completedStations.length }))
        .sort((first, second) =>
          second.completedStations - first.completedStations ||
          first.teamName.localeCompare(second.teamName, "cs"),
        );
      let rank = 0;
      let previousCompleted: number | undefined;
      const gameResults = ranked.map((result, index) => {
        if (result.completedStations !== previousCompleted) rank = index + 1;
        previousCompleted = result.completedStations;
        return { ...result, rank };
      });
      return {
        ...current,
        gameStoppedAt: current.gameStoppedAt ?? now,
        gameClosedAt: now,
        gameResults,
        events: [
          { id: randomUUID(), message: "Hlavní admin uzavřel hru a vyhlásil výsledky.", tone: "success" as const, createdAt: now },
          ...current.events,
        ].slice(0, 12),
      };
    });
    return NextResponse.json({ ok: true, state: sanitizeGameState(state, user) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Akci se nepodařilo provést." },
      { status: 409 },
    );
  }
}

import { NextResponse } from "next/server";

import {
  getSession,
  getSessionToken,
  hashTeamPassword,
  sanitizeGameState,
  verifyRequestOrigin,
} from "@/lib/auth";
import { normalizeGameState, readGameState, updateGameState, type GameState } from "@/lib/game-store";

export async function GET(request: Request) {
  const user = await getSession(getSessionToken(request));
  if (!user) return NextResponse.json({ error: "Přihlaste se pro pokračování." }, { status: 401 });

  const state = await readGameState();
  return NextResponse.json(sanitizeGameState(state, user));
}

export async function POST(request: Request) {
  if (!verifyRequestOrigin(request)) {
    return NextResponse.json({ error: "Požadavek byl odmítnut." }, { status: 403 });
  }
  const user = await getSession(getSessionToken(request));
  if (!user) return NextResponse.json({ error: "Přihlášení vypršelo." }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000_000) {
    return NextResponse.json({ error: "Požadavek je příliš velký." }, { status: 413 });
  }

  let payload: GameState;
  try {
    payload = normalizeGameState(await request.json() as Partial<GameState>);
  } catch {
    return NextResponse.json({ error: "Neplatná data hry." }, { status: 400 });
  }
  if (!Array.isArray(payload.stations) || !Array.isArray(payload.teams)) {
    return NextResponse.json({ error: "Neplatná data hry." }, { status: 400 });
  }

  if (user.role === "team") {
    const state = await readGameState();
    return NextResponse.json({ ok: true, state: sanitizeGameState(state, user) });
  }

  const currentState = await readGameState();
  const existingTeamIds = new Set(currentState.teams.map((team) => team.id));
  const incomingNames = new Set(currentState.teams.map((team) => team.name.trim().toLowerCase()));
  for (const team of payload.teams) {
    if (existingTeamIds.has(team.id)) continue;
    const normalizedName = team.name.trim().toLowerCase();
    if (!normalizedName || normalizedName.length > 80 || incomingNames.has(normalizedName)) {
      return NextResponse.json({ error: "Názvy týmů musí být vyplněné a jedinečné." }, { status: 400 });
    }
    incomingNames.add(normalizedName);
    if (team.password.trim().length < 8) {
      return NextResponse.json({ error: "Nový tým musí mít heslo alespoň 8 znaků." }, { status: 400 });
    }
  }

  const nextState = await updateGameState((current) => {
    const submittedTeams = new Map(payload.teams.map((team) => [team.id, team]));
    const isOutdatedGameState = payload.gameStartedAt !== current.gameStartedAt;
    const mergedExistingTeams = current.teams.map((oldTeam) => {
      if (isOutdatedGameState) return oldTeam;
      const team = submittedTeams.get(oldTeam.id);
      if (!team) return oldTeam;
      const submittedPassword = team.password.trim();
      const password = submittedPassword
        ? submittedPassword.startsWith("scrypt$")
          ? submittedPassword
          : hashTeamPassword(submittedPassword)
        : oldTeam.password;
      submittedTeams.delete(team.id);
      return {
        ...team,
        password,
        completedStations: [...new Set([...oldTeam.completedStations, ...team.completedStations])],
        scannedStationIds: [...new Set([...oldTeam.scannedStationIds, ...team.scannedStationIds])],
      };
    });
    const addedTeams = [...submittedTeams.values()].map((team) => ({
      ...team,
      password: team.password.startsWith("scrypt$") ? team.password : hashTeamPassword(team.password),
    }));
    const currentSubmissions = new Map(current.submissions.map((submission) => [submission.id, submission]));
    for (const submission of payload.submissions) {
      const currentSubmission = currentSubmissions.get(submission.id);
      if (!currentSubmission || (
        user.role === "admin" &&
        currentSubmission.status === "pending" &&
        !currentSubmission.archivedAt
      )) {
        currentSubmissions.set(submission.id, submission);
      }
    }
    const mergedEvents = new Map(current.events.map((event) => [event.id, event]));
    for (const event of payload.events) {
      if (!mergedEvents.has(event.id)) mergedEvents.set(event.id, event);
    }

    const currentMissions = new Map(current.flashMissions.map((mission) => [mission.id, mission]));
    const submittedMissions = payload.flashMissions.map((mission) => {
      const existingMission = currentMissions.get(mission.id);
      currentMissions.delete(mission.id);
      return existingMission?.archivedAt
        ? { ...mission, archivedAt: existingMission.archivedAt }
        : mission;
    });

    return {
      ...payload,
      gameStartedAt: current.gameStartedAt,
      submissions: [...currentSubmissions.values()],
      flashMissions: [...submittedMissions, ...currentMissions.values()],
      teams: [...mergedExistingTeams, ...addedTeams],
      events: [...mergedEvents.values()]
        .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
        .slice(0, 12),
    };
  });
  return NextResponse.json({ ok: true, state: sanitizeGameState(nextState, user) });
}
